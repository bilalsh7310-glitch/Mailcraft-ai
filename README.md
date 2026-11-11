# MailCraft AI

A Flask web app that writes, replies to and polishes emails with AI. It has a dashboard, an email workspace, saved history and settings. AI generation runs through [OpenRouter](https://openrouter.ai), and the API key stays on the server.

## Features

- **Five email modes**: write a new email, reply to an email, improve a draft, follow-up email, subject line ideas
- **Controls**: six tones, ten languages, short / medium / long length, optional recipient
- **Result card**: subject and body, with copy, regenerate, download (.txt) and clear
- **Dashboard**: welcome section, stats, feature cards, recent email activity
- **History**: your last 30 emails, with search, reopen, copy, download and delete
- **Settings**: your name (used in sign-offs), default tone, language, length and AI model
- **Layout**: dark navy sidebar that collapses on desktop and becomes a drawer on mobile; toast notifications, skeleton loading and empty states

History and settings are stored in your browser (localStorage). Nothing is saved on the server.

## Project files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure for all four views |
| `style.css` | Design system (colors, spacing, radius and shadow variables), layout, responsive rules |
| `script.js` | Navigation, form handling, API calls, rendering, history, settings, toasts |
| `config.json` | Modes, tones, lengths, languages, models, limits (no secrets) |
| `app.py` | Flask backend: validation, prompts, OpenRouter calls |
| `requirements.txt` | Python dependencies |
| `.env.example` | Template for environment variables |
| `.gitignore` | Keeps `.env` out of Git |

## Run locally

You need Python 3.9 or newer and an OpenRouter API key from <https://openrouter.ai/keys>.

```bash
python -m venv venv
# Windows (PowerShell): venv\Scripts\Activate.ps1
# macOS / Linux:        source venv/bin/activate

pip install -r requirements.txt

# Windows: copy .env.example .env      macOS / Linux: cp .env.example .env
# Open .env and set OPENROUTER_API_KEY=your_key_here

python app.py
```

Open <http://localhost:5000>. If the key is missing, a warning banner appears and the Generate button stays disabled.

## API

| Route | Method | Description |
| --- | --- | --- |
| `/api/health` | GET | Server status and whether an API key is configured |
| `/api/config` | GET | Public settings for the UI |
| `/api/generate` | POST | Writes an email or subject lines |

`/api/generate` takes `mode`, `prompt`, `original`, `recipient`, `tone`, `length`, `language`, `model`, `sender_name`, `sender_role`. It returns `{ "ok": true, "data": { "subject", "body" } }`, or `{ "data": { "subjects": [...] } }` in subject-line mode. Errors look like `{ "ok": false, "error": { "code", "message" } }`.

## Configuration

Edit `config.json` to change modes, tones, languages, lengths, input limits and the model list. Model IDs change over time, so check <https://openrouter.ai/models> and replace any that stop working. The default model can also be set with `OPENROUTER_MODEL` in your environment, which overrides the file. Never put an API key in `config.json`.

## Deploy on Render

1. Push the project to a GitHub repository (`.gitignore` keeps `.env` out).
2. In Render choose **New**, then **Web Service**, and connect the repository.
3. Settings:
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn app:app --workers 1 --threads 8 --timeout 120`
4. Under **Environment** add `OPENROUTER_API_KEY` (required), and optionally `OPENROUTER_MODEL` and `SITE_URL`.
5. Select **Create Web Service**.

Use one worker so the in-memory rate limiter stays consistent. Render's free tier sleeps after inactivity, so the first request after a pause can take about a minute.

## Troubleshooting

| Message | What to do |
| --- | --- |
| API key banner | Set `OPENROUTER_API_KEY` and restart the server |
| "rejected the API key" | The key is wrong or revoked. Create a new one |
| "out of credits" | Add credits on OpenRouter or pick a lower-cost model in Settings |
| "model is not available" | Update the model ID in `config.json` |
| "took too long" | Choose a faster model in Settings or shorten your notes |

## Privacy and security

- The API key is read from the server environment and never sent to the browser.
- Only `index.html`, `style.css` and `script.js` are served as files. `config.json`, `.env` and `app.py` are not reachable by URL.
- Inputs are validated on the server (length, mode, tone, language, model allow-list). Results are inserted into the page as plain text.
- Your notes and any pasted email are sent to OpenRouter and the model provider you choose. Check their data policies for confidential content.
