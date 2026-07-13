#!/usr/bin/env python3
"""Extract and chunk the Peter Lynch PDFs for the RAG index.

Usage:
  pip install pypdf
  python3 extract.py "One Up on Wall Street=/path/one-up.pdf" "Beating the Street=/path/beating.pdf"

Writes chunks.json next to this script: [{ "source", "idx", "text" }, ...].
Only derived text lives here — keep chunks.json and the built index OUT of any
public repo (it's copyrighted book content). It belongs in your database.
"""
import json, os, re, sys
from pypdf import PdfReader

CHUNK_CHARS = 900
OVERLAP_SENTENCES = 1


def normalize(t: str) -> str:
    t = t.replace("\t", " ")
    t = re.sub(r"-\n", "", t)          # de-hyphenate line breaks
    t = re.sub(r"\s+", " ", t)
    return t.strip()


def split_sentences(text: str):
    # naive but fine for chunking
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if p.strip()]


def chunk(text: str):
    sents = split_sentences(text)
    chunks, cur = [], []
    cur_len = 0
    for s in sents:
        cur.append(s)
        cur_len += len(s) + 1
        if cur_len >= CHUNK_CHARS:
            chunks.append(" ".join(cur))
            cur = cur[-OVERLAP_SENTENCES:] if OVERLAP_SENTENCES else []
            cur_len = sum(len(x) + 1 for x in cur)
    if cur:
        chunks.append(" ".join(cur))
    return chunks


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    out = []
    for arg in sys.argv[1:]:
        source, path = arg.split("=", 1)
        reader = PdfReader(path)
        full = normalize(" ".join((p.extract_text() or "") for p in reader.pages))
        pieces = chunk(full)
        for i, c in enumerate(pieces):
            if len(c) > 120:  # skip tiny fragments
                out.append({"source": source, "idx": i, "text": c})
        print(f"{source}: {len(reader.pages)} pages -> {len(pieces)} chunks")

    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), "chunks.json")
    with open(dest, "w") as f:
        json.dump(out, f)
    print(f"wrote {len(out)} chunks to {dest}")


if __name__ == "__main__":
    main()
