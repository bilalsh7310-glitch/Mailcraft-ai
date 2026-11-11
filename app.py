        lines.append(f"RECIPIENT: {p['recipient']}")
    sender = ", ".join(x for x in (p["sender_name"], p["sender_role"]) if x)
    if sender:
        lines.append(f"SENDER: {sender} (use the name in the sign-off)")

    lines.append(f'\nSENDER\'S NOTES:\n"""\n{p["prompt"]}\n"""')
    if p["original"]:
        label = {"reply": "RECEIVED EMAIL", "improve": "DRAFT", "followup": "PREVIOUS EMAIL"}.get(p["mode"], "ORIGINAL")
        lines.append(f'\n{label}:\n"""\n{p["original"]}\n"""')

    if p["mode"] == "subjects":
        lines.append(
            "\nRules: each subject line is 60 characters or fewer, specific, honest (no clickbait or spam words) "
            "and varied in style (direct, curiosity, benefit, question, urgency). Add a very short note on why it works."
            '\nReturn JSON exactly like:\n{"subjects":[{"text":"...","note":"..."}]}'
        )
    else:
        lines.append(
            "\nRules: include a subject line, a greeting, well-structured short paragraphs and a sign-off. "
            "Do not invent details. Use \\n\\n between paragraphs inside the body string. "
            "Do not include the subject line inside the body."
            '\nReturn JSON exactly like:\n{"subject":"...","body":"..."}'
        )
    return "\n".join(lines)


# --------------------------------------------------------------------------
# Result normalisation (so the browser always receives the same shape)
# --------------------------------------------------------------------------
def as_str(value, limit: int) -> str:
    return str(value).strip()[:limit] if value is not None else ""


def normalize_result(mode: str, raw: dict) -> dict:
    if mode == "subjects":
        items = []
        for item in raw.get("subjects", []) if isinstance(raw.get("subjects"), list) else []:
            if isinstance(item, dict):
                text = as_str(item.get("text"), 200)
                note = as_str(item.get("note"), 300)
            else:
                text, note = as_str(item, 200), ""
            if text:
                items.append({"text": text, "note": note})
        if not items:
            raise ApiError("The AI did not return any subject lines. Please try again.", 502, "bad_json")
        return {"subjects": items[:12]}

    subject = as_str(raw.get("subject"), 200)
    body = as_str(raw.get("body"), 8000).replace("\\n", "\n")
    if not body:
        raise ApiError("The AI did not return an email body. Please try again.", 502, "bad_json")
    return {"subject": subject, "body": body}


# --------------------------------------------------------------------------
# API routes
# --------------------------------------------------------------------------
@app.get("/api/health")
def api_health():
    return jsonify(ok=True, status="ok", api_key_configured=bool(os.getenv("OPENROUTER_API_KEY", "").strip()))


@app.get("/api/config")
def api_config():
    """Only public, non-secret settings are sent to the browser."""
    return jsonify(
        ok=True,
        data={
            "app": CONFIG["app"],
            "modes": CONFIG["modes"],
            "tones": CONFIG["tones"],
            "lengths": [{k: v for k, v in l.items() if k != "max_tokens"} for l in CONFIG["lengths"]],
            "languages": CONFIG["languages"],
            "models": model_list(),
            "default_model": CONFIG["openrouter"]["default_model"],
            "defaults": CONFIG["defaults"],
            "limits": CONFIG["limits"],
        },
    )


@app.post("/api/generate")
def api_generate():
    enforce_rate_limit()
    p = validate_payload(request.get_json(silent=True))
    max_tokens = LENGTHS[p["length"]]["max_tokens"] if p["mode"] != "subjects" else 700

    # One retry if the model returns text that is not valid JSON.
    parsed = None
    for attempt in range(2):
        suffix = "" if attempt == 0 else "\n\nYour previous reply was not valid JSON. Reply again with ONLY the JSON object."
        parsed = parse_json(call_openrouter(SYSTEM_PROMPT, build_prompt(p) + suffix, p["model"], max_tokens))
        if isinstance(parsed, dict):
            break
    if not isinstance(parsed, dict):
        raise ApiError("The AI reply could not be read. Please try again.", 502, "bad_json")

    return jsonify(ok=True, data=normalize_result(p["mode"], parsed), model=p["model"])


# --------------------------------------------------------------------------
# Frontend files (only these are served; config.json and .env stay private)
# --------------------------------------------------------------------------
PUBLIC_FILES = {"style.css", "script.js"}


@app.get("/")
def index():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/<path:filename>")
def public_file(filename: str):
    if filename in PUBLIC_FILES:
        return send_from_directory(BASE_DIR, filename)
    if filename.startswith("api/"):
        return jsonify(ok=False, error={"code": "not_found", "message": "Unknown API route."}), 404
    return "Not found", 404


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=os.getenv("FLASK_DEBUG", "0") == "1")
