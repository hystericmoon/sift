"""
tg_join_cleaner.py

Finds private chats whose ONLY content is a "X joined Telegram" notice
(including ones from accounts that were later deleted) and deletes them.

Safe by default: it scans and lists first, and deletes nothing until you
type DELETE. Chats where anyone has sent a real message are never touched.

Setup:
    pip3 install telethon
    python3 tg_join_cleaner.py
"""

import asyncio
import os

from telethon import TelegramClient
from telethon.tl.types import MessageActionContactSignUp

SESSION_NAME = "join_cleaner"  # creates join_cleaner.session; delete it when done


def get_credentials():
    api_id = os.environ.get("TG_API_ID") or input("api_id: ").strip()
    api_hash = os.environ.get("TG_API_HASH") or input("api_hash: ").strip()
    return int(api_id), api_hash


def is_join_notice(message):
    # Telegram marks these as a distinct service action, so this is an exact
    # match, not a text search on "joined Telegram".
    return message is not None and isinstance(
        getattr(message, "action", None), MessageActionContactSignUp
    )


async def find_candidates(client):
    candidates, scanned = [], 0
    async for dialog in client.iter_dialogs():
        scanned += 1
        if not dialog.is_user:
            continue
        user = dialog.entity
        if user.is_self or user.bot:
            continue
        # Cheap check: the latest message must be the join notice.
        if not is_join_notice(dialog.message):
            continue
        # Strict check: it must be the ONLY message in the chat.
        recent = await client.get_messages(user, limit=2)
        if len(recent) == 1 and is_join_notice(recent[0]):
            candidates.append(dialog)
    return scanned, candidates


async def main():
    api_id, api_hash = get_credentials()
    client = TelegramClient(SESSION_NAME, api_id, api_hash)
    client.flood_sleep_threshold = 300  # wait out Telegram rate limits automatically

    async with client:  # prompts for phone number, login code and 2FA password
        print("\nScanning your chats...")
        scanned, candidates = await find_candidates(client)
        print(f"\nScanned {scanned} chats. Found {len(candidates)} 'joined Telegram' chats:\n")
        for d in candidates:
            print(f"  {d.message.date:%d/%m/%y}  {d.name or 'Deleted Account'}")

        if not candidates:
            return

        answer = input(f"\nType DELETE to remove these {len(candidates)} chats (anything else cancels): ")
        if answer.strip() != "DELETE":
            print("Cancelled. Nothing was deleted.")
            return

        total = len(candidates)
        for i, d in enumerate(candidates, 1):
            name = d.name or "Deleted Account"
            try:
                await client.delete_dialog(d.entity)  # removes the chat for you only
                print(f"  [{i}/{total}] deleted  {name}")
            except Exception as e:
                print(f"  [{i}/{total}] FAILED   {name}: {e}")
            await asyncio.sleep(1)  # gentle pacing to avoid rate limits

        print("\nDone. Contacts are untouched; only the empty chats were removed.")
        print(f"Tip: delete {SESSION_NAME}.session now if you won't run this again.")


if __name__ == "__main__":
    asyncio.run(main())
