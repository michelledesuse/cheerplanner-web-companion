"""HTML email templates for transactional reminders.

Kept as plain Python f-strings (no external Jinja dep) so adding/changing a
template stays an obvious 30-second edit.
"""
from __future__ import annotations

from typing import List, Dict, Any

from core.email import unsubscribe_link

BRAND = "CheerPlanner"
ACCENT = "#E11D48"
BG = "#F8FAFC"
CARD = "#FFFFFF"
TEXT = "#0F172A"
MUTED = "#64748B"

_FOOTER_TMPL = (
    '<tr><td style="padding:20px 28px 28px 28px;color:{muted};font-size:12px;line-height:1.5;'
    'border-top:1px solid #E2E8F0">'
    '<p style="margin:0 0 6px 0">You\'re receiving this because reminders are turned on for '
    'your {brand} account.</p>'
    '<p style="margin:0"><a href="{unsub}" style="color:{muted};text-decoration:underline">'
    'Turn off reminders</a> &middot; '
    '<a href="{web}/settings/notifications" style="color:{muted};text-decoration:underline">'
    'Manage in app</a></p></td></tr>'
)


def _shell(title: str, body_html: str, unsubscribe_token: str | None, web_url: str) -> str:
    footer = ""
    if unsubscribe_token:
        footer = _FOOTER_TMPL.format(
            muted=MUTED, brand=BRAND,
            unsub=unsubscribe_link(unsubscribe_token),
            web=web_url,
        )
    return (
        '<!doctype html><html><body style="margin:0;padding:24px 12px;background:' + BG + ';'
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;'
        'color:' + TEXT + ';">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="max-width:560px;margin:0 auto;background:' + CARD + ';'
        'border-radius:12px;overflow:hidden;border:1px solid #E2E8F0">'
        '<tr><td style="padding:20px 28px;background:' + ACCENT + ';color:#fff;'
        'font-size:18px;font-weight:700;letter-spacing:0.2px">' + BRAND + '</td></tr>'
        '<tr><td style="padding:24px 28px 8px 28px"><h1 '
        'style="margin:0 0 8px 0;font-size:20px;line-height:1.3">' + title + '</h1></td></tr>'
        '<tr><td style="padding:8px 28px 24px 28px;font-size:15px;line-height:1.55">' + body_html + '</td></tr>'
        + footer +
        '</table></body></html>'
    )


# ============================================================
# Password reset
# ============================================================
def render_password_reset(name: str | None, deep_link: str, web_link: str, ttl_minutes: int = 30) -> tuple[str, str, str]:
    safe_name = (name or "there").split(" ")[0]
    subject = f"Reset your {BRAND} password"
    body = (
        f"<p>Hi {safe_name}, we got a request to reset your {BRAND} password.</p>"
        f"<p>Tap the button below to set a new one. This link expires in <strong>{ttl_minutes} minutes</strong>.</p>"
        f'<p style="text-align:center;margin:24px 0">'
        f'<a href="{web_link}" '
        f'style="display:inline-block;background:{ACCENT};color:#fff;padding:12px 24px;'
        f'border-radius:10px;text-decoration:none;font-weight:700">Reset password</a></p>'
        f'<p style="font-size:13px;color:{MUTED}">Button not working? Copy and paste this link into your browser:<br>'
        f'<a href="{web_link}" style="color:{ACCENT};word-break:break-all">{web_link}</a></p>'
        f'<p style="font-size:13px;color:{MUTED}">It works on your phone or computer. If you have the '
        f'{BRAND} app installed, the page will offer to open it.</p>'
        f'<p style="font-size:13px;color:{MUTED}">If you didn\'t request this, you can safely ignore this email.</p>'
    )
    html = _shell("Reset your password", body, unsubscribe_token=None, web_url="")
    text = (
        f"Hi {safe_name}, reset your {BRAND} password by opening this link "
        f"(expires in {ttl_minutes} minutes):\n\n{web_link}\n\n"
        f"It works on your phone or computer.\n\n"
        f"Didn't request this? You can ignore this email."
    )
    return subject, html, text


# ============================================================
# Daily / weekly digest
# ============================================================
def render_digest(
    name: str | None,
    sections: List[Dict[str, Any]],
    frequency: str,
    unsubscribe_token: str,
    web_url: str,
) -> tuple[str, str, str]:
    """sections = [{ 'title': str, 'items': [{ 'title': str, 'subtitle': str, 'when': str, 'amount': str | None }] }]"""
    safe_name = (name or "there").split(" ")[0]
    total = sum(len(s.get("items", [])) for s in sections)
    freq_label = "your weekly" if frequency == "weekly" else "today's"
    subject = f"{BRAND}: {total} reminder{'s' if total != 1 else ''} {('this week' if frequency == 'weekly' else 'for today')}"
    if total == 0:
        # Nothing due — skip sending entirely (caller should also short-circuit).
        subject = f"{BRAND}: all clear \U0001F389"

    section_html_parts: List[str] = []
    for sec in sections:
        items = sec.get("items") or []
        if not items:
            continue
        rows = ""
        for it in items:
            amt = it.get("amount")
            amt_html = (
                f'<div style="font-weight:700;color:{TEXT};white-space:nowrap;margin-left:12px">{amt}</div>'
                if amt else ""
            )
            rows += (
                '<tr><td style="padding:10px 0;border-bottom:1px solid #F1F5F9">'
                '<table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>'
                f'<td style="vertical-align:top">'
                f'<div style="font-weight:600;color:{TEXT};font-size:15px">{it.get("title", "")}</div>'
                f'<div style="color:{MUTED};font-size:13px;margin-top:2px">{it.get("subtitle", "")}</div>'
                f'<div style="color:{MUTED};font-size:12px;margin-top:4px">{it.get("when", "")}</div>'
                f'</td><td style="vertical-align:top;text-align:right;white-space:nowrap">{amt_html}</td>'
                '</tr></table></td></tr>'
            )
        section_html_parts.append(
            f'<h2 style="margin:24px 0 8px 0;font-size:14px;text-transform:uppercase;letter-spacing:0.5px;color:{MUTED}">{sec.get("title", "")}</h2>'
            f'<table width="100%" cellpadding="0" cellspacing="0" role="presentation">{rows}</table>'
        )

    if total > 0:
        body = (
            f"<p>Hi {safe_name}, here's {freq_label} reminder digest from {BRAND}.</p>"
            + "".join(section_html_parts)
        )
    else:
        body = f"<p>Hi {safe_name}, you're all caught up. Nothing due {('this week' if frequency == 'weekly' else 'in the next few days')} \u2014 great work!</p>"

    html = _shell(
        "Here's what's coming up" if total > 0 else "All clear",
        body,
        unsubscribe_token=unsubscribe_token,
        web_url=web_url,
    )

    # Plaintext version
    text_lines: List[str] = [f"Hi {safe_name},", ""]
    if total == 0:
        text_lines.append("You're all caught up \u2014 nothing due.")
    else:
        text_lines.append("Here's what's coming up:")
        text_lines.append("")
        for sec in sections:
            items = sec.get("items") or []
            if not items:
                continue
            text_lines.append(sec.get("title", ""))
            for it in items:
                line = f"  \u2022 {it.get('title', '')}"
                if it.get("subtitle"):
                    line += f" \u2014 {it.get('subtitle')}"
                if it.get("when"):
                    line += f" ({it.get('when')})"
                if it.get("amount"):
                    line += f" {it.get('amount')}"
                text_lines.append(line)
            text_lines.append("")
    text_lines.append("")
    text_lines.append(f"To turn off reminders: {unsubscribe_link(unsubscribe_token)}")
    text = "\n".join(text_lines)

    return subject, html, text
