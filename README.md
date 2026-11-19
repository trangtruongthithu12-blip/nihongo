# Nihongo Study

A web app for learning Japanese from zero: hiragana, katakana, then JLPT N5 kanji and words. It is made for the iPad with Apple Pencil, and also works on iPhone and computer. It can be installed on the Home Screen and works offline.

## What's inside

- **Daily session (about 20 minutes):** reviews first, then new items in the recommended order: hiragana → katakana → kanji and words.
- **Apple Pencil writing:** every stroke is checked as you write it: the right stroke, in the right order and direction, and roughly the right shape. There are three levels: trace → hints → from memory. Fingers are ignored once the Pencil has been used, so your palm can rest on the screen.
- **Spaced repetition:** each item comes back just before you would forget it. You see it again after 1 minute, then 10 minutes, then days and months.
- **Words with context:** each of the 717 N5 words has an example sentence with furigana, an English translation and audio.
- **My book:** add the words from your Minna no Nihongo lesson. The app finds the reading, meaning and an example sentence, and the words join your reviews.
- **Free writing practice:** practise any kana, kanji or word.

## Preview on your computer

```
node scripts/serve.mjs
```

Then open http://localhost:5173. To try it on the iPad, open `http://<your PC's IP>:5173` while it's on the same Wi-Fi. The Apple Pencil works, but installing on the Home Screen and working offline need the published (https) version.

## Publish (GitHub Pages)

1. Create a free GitHub account and a new **public** repository, e.g. `nihongo`.
2. Push this folder to it (branch `main`).
3. In the repository: **Settings → Pages → Source: GitHub Actions**.
4. After about a minute the app is at `https://<username>.github.io/nihongo/`.
5. On iPad/iPhone, open it in **Safari**, then **Share → Add to Home Screen**.

## Sync between devices (Supabase)

1. Create a free account at supabase.com and a new project.
2. **SQL Editor:** paste [supabase/setup.sql](supabase/setup.sql) and run it.
3. **Authentication → Providers → Email:** keep it on. Under **Authentication → Email Templates → Magic Link**, make sure the email shows the code: `{{ .Token }}`.
4. **Project Settings → API:** copy the **Project URL** and the **anon public** key into [app/js/config.js](app/js/config.js), then push.
5. In the app: **Settings → Sync**, enter your email, then type the 6-digit code. Do the same on each device.

## Rebuild the data

```
cd scripts && npm install
node build-data.mjs ../source-data ../app/data
```

This needs the downloads in `source-data/downloads` and `source-data/kanjivg` (see the header of [scripts/build-data.mjs](scripts/build-data.mjs)). Hand-written example sentences are in [scripts/extra-examples.txt](scripts/extra-examples.txt).

## Credits

KanjiVG (CC BY-SA 3.0), KANJIDIC2 and JMdict by EDRDG (CC BY-SA 4.0), Tatoeba (CC BY 2.0 FR), and the JLPT lists by Jonathan Waller (CC BY). Furigana is generated with kuromoji.js. Minna no Nihongo content is not included.
