# PDF Agent RAG — Client

Next.js frontend for the PDF Agent RAG application. Upload a PDF and ask questions about its content using AI.

## Stack

- **Next.js** (App Router)
- **Clerk** — authentication
- **shadcn/ui** — component library
- **Tailwind CSS** — styling

## Getting Started

1. Copy `.env.local.example` to `.env.local` and fill in the required keys (Clerk publishable key and secret key).
2. Install dependencies:
   ```bash
   pnpm install
   ```
3. Start the development server:
   ```bash
   pnpm dev
   ```

The client expects the backend server to be running at `http://localhost:8000`. See the `server/` directory for setup instructions.
