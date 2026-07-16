"""
Launch-email dispatcher for Digi-Child.

When a case manager approves a parent's enrollment, the parent receives an
email with their simulation launch link. Live mode sends real mail through
SMTP (set SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS, e.g. a Gmail app
password); without credentials it runs in DEMO MODE: the email is composed,
logged, and returned as a preview so the flow is fully demonstrable offline.
"""

import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASS = os.environ.get("SMTP_PASS", "")
FROM_ADDR = os.environ.get("SMTP_FROM", SMTP_USER or "noreply@digichild.local")


def available():
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASS)


def compose_launch_email(parent_name, slot_label, launch_url):
    subject = "Your Digi-Child session is approved - launch link inside"
    body = f"""Hello {parent_name or 'there'},

Great news! Your case manager has approved your Digi-Child evaluation session.

  Scheduled time: {slot_label}

When your session begins, click your personal simulation link:

  {launch_url}

Tips for your session:
  - Use Chrome or Edge, and allow microphone access -- Mira hears your tone
    of voice, not just your words.
  - Find a quiet room. Speak to her the way you would to a real child.
  - There is no way to fail. This is practice, and every repair counts.

We look forward to seeing you,
The Digi-Child Clinical Team
"""
    return subject, body


def send_launch_email(to_addr, parent_name, slot_label, launch_url):
    """Send (or mock-send) the approval + launch email. Never raises."""
    subject, body = compose_launch_email(parent_name, slot_label, launch_url)
    if not available():
        print(f"[emailer] DEMO MODE - would send to {to_addr}:\n{subject}\n{body}", flush=True)
        return {
            "sent": False,
            "source": "mock",
            "to": to_addr,
            "subject": subject,
            "preview": body,
            "note": "Demo mode: no SMTP credentials configured; email composed but not transmitted.",
        }
    try:
        msg = MIMEMultipart()
        msg["From"] = FROM_ADDR
        msg["To"] = to_addr
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain"))
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as s:
            s.starttls()
            s.login(SMTP_USER, SMTP_PASS)
            s.sendmail(FROM_ADDR, [to_addr], msg.as_string())
        return {"sent": True, "source": "smtp", "to": to_addr, "subject": subject}
    except Exception as exc:
        print(f"[emailer] send failed ({type(exc).__name__}): {exc}", flush=True)
        return {"sent": False, "source": "error", "to": to_addr, "subject": subject, "error": str(exc)}
