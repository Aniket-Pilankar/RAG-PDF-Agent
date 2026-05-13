import { Worker } from 'bullmq';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/qdrant';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const worker = new Worker(
  'file-upload-queue',
  async (job) => {
    const data = JSON.parse(job.data);
    console.log('Job data:', data);

    try {
      const loader = new PDFLoader(data.path);
      const docs = await loader.load();

      docs.forEach(doc => {
        doc.metadata.userId = data.userId;
        doc.metadata.pdfId  = data.pdfId;
      });

      const embeddings = new OpenAIEmbeddings({
        model: 'text-embedding-3-small',
        apiKey: process.env.OPENAI_API_KEY,
      });

      const vectorStore = await QdrantVectorStore.fromExistingCollection(
        embeddings,
        { url: 'http://localhost:6333', collectionName: 'pdf-agent-rag' }
      );

      await vectorStore.addDocuments(docs);
      console.log('Documents added to vector store');

      await prisma.pdf.update({
        where: { id: data.pdfId },
        data: { status: 'ready' },
      });
    } catch (err) {
      console.error('Worker error:', err);
      if (data.pdfId) {
        await prisma.pdf.update({
          where: { id: data.pdfId },
          data: { status: 'failed' },
        });
      }
      throw err;
    }
  },
  {
    concurrency: 100,
    connection: { host: 'localhost', port: '6379' },
  }
);
