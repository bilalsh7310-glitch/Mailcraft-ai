def build_prompt(p: dict) -> str:
    lines = [
        "Create a professional email based on the information provided below.",
        f"MODE: {p['mode']}",
        f"TONE: {p['tone']}",
        f"LENGTH: {p['length']}",
        f"LANGUAGE: {p['language']}",
        f"RECIPIENT: {p['recipient']}",
    ]

    sender = ", ".join(
        x for x in (p["sender_name"], p["sender_role"]) if x
    )

    if sender:
        lines.append(
            f"SENDER: {sender} (use the name in the sign-off)"
        )

    lines.append(
        f'\nSENDER\'S NOTES:\n"""\n{p["prompt"]}\n"""'
    )

    if p["original"]:
        label = {
            "reply": "RECEIVED EMAIL",
            "improve": "DRAFT",
            "followup": "PREVIOUS EMAIL",
        }.get(p["mode"], "ORIGINAL")

        lines.append(
            f'\n{label}:\n"""\n{p["original"]}\n"""'
        )

    if p["mode"] == "subjects":
        lines.append(
            "\nRules: each subject line is 60 characters or fewer, "
            "specific, honest (no clickbait or spam words) and varied "
            "in style (direct, curiosity, benefit, question, urgency). "
            "Add a very short note on why it works."
            '\nReturn JSON exactly like:\n'
            '{"subjects":[{"text":"...","note":"..."}]}'
        )
    else:
        lines.append(
            "\nRules: include a subject line, a greeting, "
            "well-structured short paragraphs and a sign-off. "
            "Do not invent details. Use \\n\\n between paragraphs "
            "inside the body string. "
            "Do not include the subject line inside the body."
            '\nReturn JSON exactly like:\n'
            '{"subject":"...","body":"..."}'
        )

    return "\n".join(lines)