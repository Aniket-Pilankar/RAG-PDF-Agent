-- CreateIndex
CREATE INDEX "Pdf_userId_uploadedAt_idx" ON "Pdf"("userId", "uploadedAt");

-- CreateIndex
CREATE INDEX "ChatSession_userId_updatedAt_idx" ON "ChatSession"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Message_sessionId_createdAt_idx" ON "Message"("sessionId", "createdAt");
