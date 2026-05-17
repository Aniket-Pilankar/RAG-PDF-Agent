import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { createServer } from 'http';
import { promises as fs } from 'fs';
import { Server } from 'socket.io';
import { Queue, QueueEvents, Job } from 'bullmq';
import { OpenAIEmbeddings, ChatOpenAI } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
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

app.post('/chat/sessions', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { title } = req.body;
  const session = await prisma.chatSession.create({
    data: { userId, title: title?.slice(0, 100) || 'New Chat' },
  });

  return res.json(session);
});

app.get('/chat/sessions', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const sessions = await prisma.chatSession.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, updatedAt: true, createdAt: true },
  });

  return res.json(sessions);
});

app.get('/chat/sessions/:id/messages', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const session = await prisma.chatSession.findUnique({ where: { id: req.params.id } });
  if (!session || session.userId !== userId) return res.status(404).json({ error: 'Not found' });

  const messages = await prisma.message.findMany({
    where: { sessionId: req.params.id },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, createdAt: true },
  });

  return res.json(messages);
});

app.delete('/chat/sessions/:id', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const session = await prisma.chatSession.findUnique({ where: { id: req.params.id } });
  if (!session || session.userId !== userId) return res.status(404).json({ error: 'Not found' });

  await prisma.chatSession.delete({ where: { id: req.params.id } });
  return res.json({ success: true });
});

app.post('/chat', async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const { message: userQuery, chatHistory = [], pdfIds, sessionId } = req.body;

  if (sessionId) {
    const session = await prisma.chatSession.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== userId) return res.status(404).json({ error: 'Session not found' });
    await prisma.message.create({ data: { sessionId, role: 'user', content: userQuery } });
  }

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
      ...(pdfIds?.length ? [{ key: 'metadata.pdfId', match: { any: pdfIds } }] : []),
    ],
  };

  const retriever = vectorStore.asRetriever({ k: 5, filter });

  const contextualizeQPrompt = ChatPromptTemplate.fromMessages([
    ['system', 'Given the chat history and the latest user question which might reference context in the chat history, formulate a standalone question that can be understood without the chat history. Do NOT answer the question — just reformulate it if needed, otherwise return it as is.'],
    new MessagesPlaceholder('chat_history'),
    ['human', '{input}'],
  ]);

  const qaPrompt = ChatPromptTemplate.fromMessages([
    ['system', `You are a helpful AI Assistant who answers the user's question based on the PDF context below.\nIf you don't know the answer from the context, say you don't know — do not make things up.\n\nContext:\n{context}`],
    new MessagesPlaceholder('chat_history'),
    ['human', '{input}'],
  ]);

  console.log('chatHistory', chatHistory);

  const formattedHistory = chatHistory.map((msg) =>
    msg.role === 'user' ? new HumanMessage(msg.content) : new AIMessage(msg.content)
  );

  const standaloneQuery = formattedHistory.length > 0
    ? await contextualizeQPrompt.pipe(llm).pipe(new StringOutputParser()).invoke({ input: userQuery, chat_history: formattedHistory })
    : userQuery;

  const hydePrompt = ChatPromptTemplate.fromMessages([
    ['system', 'Write a short passage (2-4 sentences) that directly answers the following question. Write it as if it were extracted from a document — do not say "I" or address the user.'],
    ['human', '{question}'],
  ]);
  const hypotheticalAnswer = await hydePrompt.pipe(llm).pipe(new StringOutputParser()).invoke({ question: standaloneQuery });

  const docs = await retriever.invoke(hypotheticalAnswer);
  const context = docs.map((d) => d.pageContent).join('\n\n');
  const answer = await qaPrompt.pipe(llm).pipe(new StringOutputParser()).invoke({ input: userQuery, chat_history: formattedHistory, context });

  const result = { answer, context: docs };

  console.log('result', result);

  if (sessionId) {
    await Promise.all([
      prisma.message.create({ data: { sessionId, role: 'assistant', content: result.answer } }),
      prisma.chatSession.update({ where: { id: sessionId }, data: { updatedAt: new Date() } }),
    ]);
  }

  const hasNoAnswer = /i don'?t know|i do not know/i.test(result.answer);
  return res.json({ message: result.answer, docs: hasNoAnswer ? [] : result.context });
});

httpServer.listen(8000, () => console.log(`Server started on PORT:8000`));
