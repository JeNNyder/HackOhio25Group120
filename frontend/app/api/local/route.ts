// frontend/app/api/local/route.ts
export const runtime = 'nodejs';


export async function GET() {
  return new Response('chat-local ok', { status: 200 });
}


export async function POST(req: Request) {
  try {
    const { messages } = (await req.json()) as {
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    };

  
    const system = messages.find(m => m.role === 'system')?.content ?? '';
    const convo = messages
      .filter(m => m.role !== 'system')
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
    const prompt = `${system ? `System: ${system}\n` : ''}${convo}\nAssistant:`;

    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3.2', prompt, stream: true }),
    });

    if (!res.ok || !res.body) {
      return new Response(`ollama HTTP ${res.status}`, { status: 500 });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

   
    const readable = new ReadableStream({
      async start(controller) {
        let buffer = '';
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? ''; 

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const obj = JSON.parse(line);
              if (obj.response) {
                controller.enqueue(encoder.encode(obj.response));
              }
            } catch {
          
            }
          }
        }
        controller.close();
      },
    });

    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (e: any) {
    return new Response(`chat-local error: ${e?.message ?? 'unknown'}`, { status: 500 });
  }
}
