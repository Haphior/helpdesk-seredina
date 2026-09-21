# Knowledge Base

## Internal management

From **Knowledge Base** in the sidebar, any agent with write permission
can create articles (title + body) and mark them as published or not. An
unpublished article is only visible in the console — it never appears on
the public portal or in the AI copilot's searches.

## Public portal

Every published article is visible with no account needed at
`https://your-instance.example.com/kb/your-organization` — the same URL
appears as a direct reference right on the management screen, ready to
share. The portal has its own free-text search.

## Connection to the AI copilot

When an agent asks for **Suggest reply** on a ticket, the copilot
searches published articles by semantic similarity (RAG, over `pgvector`)
and, if it finds something relevant, uses it to draft the suggestion and
shows it as "Based on:" below the reply box — so the agent knows where
the suggestion came from before sending it, instead of blindly trusting
generated text. See [AI Copilot](/guide/ai-copilot) for everything else
the copilot does.

Keeping the knowledge base up to date isn't just for customers reading it
on the public portal — it directly improves the quality of AI-suggested
replies on every new ticket.
