import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { Queue, QueueEvents, Job } from 'bullmq';
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { clerkMiddleware, getAuth } from '@clerk/express';

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
app.use(clerkMiddleware());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: 'http://localhost:3000' },
});

io.on('connection', (socket) => {
  socket.on('subscribe', async (jobId) => {
    socket.join(jobId);

    // Race condition: emit immediately if job already finished before client connected
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
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file provided.' });
  }
  const job = await queue.add(
    'file-ready',
    JSON.stringify({
      filename: req.file.originalname,
      destination: req.file.destination,
      path: req.file.path,
      userId,
    })
  );
  return res.json({ message: 'uploaded', jobId: job.id });
});

app.get('/chat', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  const userQuery = req.query.message;

  const embeddings = new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
    apiKey: process.env.OPENAI_API_KEY,
  });
  const vectorStore = await QdrantVectorStore.fromExistingCollection(
    embeddings,
    {
      url: 'http://localhost:6333',
      collectionName: 'pdf-agent-rag',
    }
  );
  const ret = vectorStore.asRetriever({
    k: 2,
    filter: {
      must: [{ key: 'metadata.userId', match: { value: userId } }],
    },
  });
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

  return res.json({
    message: chatResult.content,
    docs: result,
  });
});

httpServer.listen(8000, () => console.log(`Server started on PORT:8000`));
