# Japanese learning app: plan

Separate project from the IELTS app (`d:\Programing\Project1`).

## Decisions so far (2026-11-18)

- **Devices:** iPad (with Apple Pencil), iPhone and computer.
- **Type of app:** web app hosted online, added to the Home Screen from Safari (full screen, works offline). No App Store app (that needs a Mac and a $99/year Apple account).
- **Sync:** progress syncs between devices (needs a free online database; service still to be chosen).
- **Language:** meanings and explanations in English.
- **Level:** starting from zero: hiragana and katakana first, then JLPT N5 (~100 kanji, ~800 words). N4 and higher can be added later.

## Content

- Minna no Nihongo and kanji textbooks are copyrighted, so their word lists and sentences are not copied into the app.
- Built-in content comes from open data, organised by JLPT level:
  - KanjiVG (stroke order and stroke shapes),
  - KANJIDIC and JMdict (EDRDG: kanji info, readings, meanings),
  - Tatoeba (example sentences with translations).
  Their licences (CC BY-SA / CC BY) need attribution in the app.
- **"My book" mode:** the learner adds the words from their own Minna no Nihongo lesson; the app adds readings, stroke order and example sentences.

## Core features (planned)

- Apple Pencil writing practice with stroke-by-stroke checking (order, direction, shape), moving from tracing → hints → writing from memory.
- Every word comes with an example sentence showing how it is used, plus Japanese audio.
- Spaced-repetition reviews, so words come back just before you would forget them.

## Decided (2026-11-18, round 2)

- **Hosting:** GitHub Pages (free; the app works offline once installed on the Home Screen).
- **Sync:** Supabase (free tier): one account, progress stored online and synced between devices. The app still works offline and syncs when back online.
- **No AI** in the app: all content is built in, so it's free and works offline.
- **"My book":** words are typed in (word or reading); the app looks them up in its built-in dictionary. No photo feature.
- **Study time:** about 20 minutes a day. Defaults: about 10 new words and 3-5 new kanji (or 10 new kana while learning kana) per day, plus that day's reviews. Adjustable in settings.

## Status (2026-11-18)

- ✅ 1. Data built: 208 kana, 79 N5 kanji, 717 N5 words (all with an example sentence), stroke order, and a dictionary of common words for My book.
- ✅ 2. App built and tested on iPad and iPhone screen sizes (stroke checking, sessions, reviews, My book, settings).
- ✅ 3. Installable and offline (manifest, service worker, icons).
- ⏳ 4. Publish on GitHub Pages: needs the learner's GitHub account.
- ⏳ 5. Supabase sync: code is ready; needs the learner's Supabase project URL and key in `app/js/config.js`.

## Build order

1. Data: download the open data and turn it into compact files for kana, N5 kanji, N5 vocabulary and example sentences.
2. App (works locally first, saving progress on the device): kana → kanji → vocabulary lessons, Apple Pencil writing with stroke checking, spaced-repetition reviews, audio, "My book".
3. Make it installable and offline (PWA: manifest + service worker).
4. Publish on GitHub Pages (needs the learner's GitHub account).
5. Add Supabase sync (needs the learner's Supabase account).
