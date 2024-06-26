// import { Hono } from 'hono'

// type Bindings = {
//   [key in keyof CloudflareBindings]: CloudflareBindings[key]
// }

// const app = new Hono<{ Bindings: Bindings }>()

// app.get('/', (c) => {
//   return c.text('Hello Hono!')
// })

// export default app

import { Hono } from 'hono';
import { OpenAI } from 'openai';
import * as cheerio from 'cheerio';
import { ChatCompletionMessageParam } from 'openai/resources/index.mjs';

type Bindings = {
  OPENAI_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

async function read_website_content(url: string): Promise<string> {
  console.log('reading website content');
  const response = await fetch(url);
  const body = await response.text();
  const cheerioBody = cheerio.load(body);
  const resp = {
    website_body: cheerioBody('p').text(),
    url: url,
  };
  return JSON.stringify(resp);
}

const tools: any = [
  {
    type: 'function',
    function: {
      name: 'read_website_content',
      description: 'Read the content on a given website',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to the website to read',
          },
        },
        required: ['url'],
      },
    },
  },
];

app.use('*', async (c, next) => {
  if (!c.env.OPENAI_API_KEY) {
    return c.text('OPENAI_API_KEY is not set', 500);
  }
  await next();
});

async function processOpenAIRequest(c: any, prompt: string) {
  const openai = new OpenAI({
    apiKey: c.env.OPENAI_API_KEY,
  });

  const url = c.req.query('url');
  if (!url) {
    return c.text('URL parameter is required', 400);
  }

  const messages: ChatCompletionMessageParam[] = [{ role: 'user', content: `${prompt} for the content at ${url}` }];

  const chatCompletion = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: messages,
    tools: tools,
    tool_choice: 'auto',
  });

  const assistantMessage = chatCompletion.choices[0].message;
  messages.push(assistantMessage);

  if (assistantMessage.tool_calls) {
    for (const toolCall of assistantMessage.tool_calls) {
      if (toolCall.function.name === 'read_website_content') {
        const websiteContent = await read_website_content(url);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: websiteContent,
        });
      }
    }

    const secondChatCompletion = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: messages,
    });

    return secondChatCompletion.choices[0].message.content;
  } else {
    return assistantMessage.content;
  }
}

app.get('/summarize', async (c) => {
  const content = await processOpenAIRequest(c, 'Provide a concise summary');
  return c.html(
    `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>URL Summary</title>
    </head>
    <body>
      <h1>Summary of URL</h1>
      <p>${content}</p>
    </body>
    </html>`
  );
});

app.get('/key-topics', async (c) => {
  const content = await processOpenAIRequest(c, 'List the key topics');
  return c.html(
    `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Key Topics</title>
    </head>
    <body>
      <h1>Key Topics</h1>
      <p>${content}</p>
    </body>
    </html>`
  );
});

export default app;
