// app/api/chat/route.ts
import OpenAI from 'openai';
export const runtime = 'nodejs';

export async function GET() {
  return new Response('chat api ok', { status: 200 });
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ ok:false, code:'no_key', message:'Missing OPENAI_API_KEY' }, { status: 500 });
    }

    const { messages } = await req.json() as {
      messages: { role:'system'|'user'|'assistant'; content:string }[];
    };

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 先试“非流式”拿一次头部，专门抓 401/403/429 等错误
    try {
      await client.responses.create({
        model: 'gpt-4o-mini',
        input: messages,
        temperature: 0.7,
        // 只要能到这里，说明配额/权限OK；后面再走真正的“流式”
      });
    } catch (err: any) {
      const code = err?.code || err?.error?.code;
      const status = err?.status ?? 500;
      // 配额不足 → 明确返回 429 + JSON
      if (code === 'insufficient_quota' || status === 429) {
        return Response.json(
          { ok:false, status:429, code:'insufficient_quota', message:'quota exceeded' },
          { status: 429 }
        );
      }
      // 其它错误也直接 JSON（避免 pipe 报错）
      return Response.json(
        { ok:false, status, code: code ?? 'unknown', message: err?.message ?? 'error' },
        { status: status >= 400 && status < 600 ? status : 500 }
      );
    }

    // 真正的“流式”调用（只在上面检查通过时执行）
    const emitter = await client.responses.stream({
      model: 'gpt-4o-mini',
      input: messages,
      temperature: 0.7,
    });

    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        emitter.on('response.output_text.delta', (e: any) => {
          const chunk = e?.delta ?? e?.text ?? '';
          if (chunk) controller.enqueue(enc.encode(chunk));
        });
        emitter.on('response.completed', () => controller.close());
        emitter.on('error', (e: any) => {
          // 把流错误转换为 JSON 结束（避免 next 的 pipe 错误）
          try {
            controller.enqueue(enc.encode('\n[stream aborted]\n'));
          } finally {
            controller.close();
          }
        });
      },
      cancel() { try { emitter.abort(); } catch {} },
    });

    return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  } catch (e: any) {
    return Response.json({ ok:false, message: e?.message ?? 'server error' }, { status: 500 });
  }
}

