import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createServer } from 'http';
import { promises as fs } from 'fs';
import { Server } from 'socket.io';
import { Queue, QueueEvents, Job } from 'bullmq';
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { clerkMiddleware, getAuth } from '@clerk/express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const llm = new ChatOpenAI({
  model: 'gpt-4o-mini',
  apiKey: process.env.OPENAI_API_KEY,
});

const redisConnection = { host: 'localhost', port: '6379' };

const queue = new Queue('file-upload-queue', { connection: redisConnection });
const queueEvents = new QueueEvents('file-upload-queue', { connection: redisConnection });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  },
});

const upload = multer({ storage: storage });

const app = express();
app.use(cors({ origin: 'http://localhost:3000', allowedHeaders: ['Authorization', 'Content-Type'] }));
app.use('/uploads', express.static('uploads'));
app.use(express.json());
app.use(clerkMiddleware());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: 'http://localhost:3000' },
});

io.on('connection', (socket) => {
  socket.on('subscribe', async (jobId) => {
    socket.join(jobId);

    const job = await Job.fromId(queue, jobId);
    if (job) {
      const jobState = await job.getState();
      if (jobState === 'completed' || jobState === 'failed') {
        socket.emit('job:status', { status: jobState });
      }
    }
  });
});

queueEvents.on('completed', ({ jobId }) => {
  io.to(jobId).emit('job:status', { status: 'completed' });
});
queueEvents.on('failed', ({ jobId }) => {
  io.to(jobId).emit('job:status', { status: 'failed' });
});

app.get('/', (req, res) => {
  return res.json({ status: 'All Good!' });
});

app.post('/upload/pdf', upload.single('pdf'), async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  if (!req.file) return res.status(400).json({ error: 'No PDF file provided.' });

  const pdfRecord = await prisma.pdf.create({
    data: {
      userId,
      filename: req.file.originalname,
      filePath: req.file.path,
    },
  });

  const job = await queue.add(
    'file-ready',
    JSON.stringify({
      filename: req.file.originalname,
      destination: req.file.destination,
      path: req.file.path,
      userId,
      pdfId: pdfRecord.id,
    })
  );

  return res.json({ message: 'uploaded', jobId: job.id });
});

app.get('/pdfs', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const pdfs = await prisma.pdf.findMany({
    where: { userId },
    orderBy: { uploadedAt: 'desc' },
  });

  return res.json(pdfs);
});

app.delete('/pdfs/:id', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const pdf = await prisma.pdf.findUnique({ where: { id: req.params.id } });
  if (!pdf || pdf.userId !== userId) return res.status(404).json({ error: 'Not found' });

  await fetch('http://localhost:6333/collections/pdf-agent-rag/points/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: { must: [{ key: 'metadata.pdfId', match: { value: pdf.id } }] },
    }),
  });

  await fs.unlink(pdf.filePath).catch(() => {});

  await prisma.pdf.delete({ where: { id: pdf.id } });

  return res.json({ success: true });
});

app.get('/chat', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const userQuery = req.query.message;
  const pdfIds = req.query.pdfIds ? String(req.query.pdfIds).split(',') : null;

  const embeddings = new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY,
  });

  const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
    url: 'http://localhost:6333',
    collectionName: 'pdf-agent-rag',
  });

  const filter = {
    must: [
      { key: 'metadata.userId', match: { value: userId } },
      ...(pdfIds ? [{ key: 'metadata.pdfId', match: { any: pdfIds } }] : []),
    ],
  };

  const ret = vectorStore.asRetriever({ k: 2, filter });
  const result = await ret.invoke(userQuery);

  const SYSTEM_PROMPT = `
  You are helpful AI Assistant who answeres the user query based on the available context from PDF File.
  Context:
  ${JSON.stringify(result)}
  `;

  const chatResult = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(userQuery),
  ]);

  return res.json({ message: chatResult.content, docs: result });
});

httpServer.listen(8000, () => console.log(`Server started on PORT:8000`));
