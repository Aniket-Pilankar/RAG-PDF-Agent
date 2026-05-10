import type { Metadata } from "next";
import { Noto_Sans } from "next/font/google";
import "./globals.css";
import {
  ClerkProvider,
  Show,
  SignIn,
  UserButton,
} from "@clerk/nextjs";

const notoSans = Noto_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PDF Agent RAG",
  description: "Upload a PDF and ask questions about its content using AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${notoSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClerkProvider>
          <Show when="signed-out">
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-500 to-blue-500">
              <SignIn routing="hash" />
            </div>
          </Show>
          <Show when="signed-in">
            <header className="flex justify-end items-center p-4 gap-4 h-16">
              <UserButton />
            </header>
            {children}
          </Show>
        </ClerkProvider>
      </body>
    </html>
  );
}
