// app/api/chat/route.ts
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const runtime = 'edge'; // works on Vercel/Amplify; remove if you prefer node

export async function POST(req: Request) {
  try {
    const { messages } = (await req.json()) as {
      messages: { role: 'user' | 'assistant' | 'system'; content: string }[];
    };

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Stream text tokens back to the client
    const stream = await client.responses.stream({
      model: 'gpt-4o-mini',          // inexpensive & good; change as you like
      input: messages,
      temperature: 0.7,
    });

    const readable = new ReadableStream({
      start(controller) {
        stream.on('text', (t) => controller.enqueue(new TextEncoder().encode(t)));
        stream.on('end', () => controller.close());
        stream.on('error', (e) => controller.error(e));
      },
    });

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Unknown error' }, { status: 500 });
  }
}
