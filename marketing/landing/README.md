# Shia & Co. — Landing Page

A self-contained, mobile-first landing page for Shia & Co. — no build step, no
dependencies, one file (`index.html`).

## Features
- **Bilingual EN/ES toggle** in the header — switches *all* visible copy instantly.
- **Email + SMS signup form** ("Be the first to know"): first name, email, phone, SMS
  opt-in, optional baby due-date/birthday → shows a warm thank-you on submit.
- Hero, **Shia Songs™** hero product, 4 signature gift bundles, 3 brand pillars,
  testimonials, footer with social links.
- Soft cream / powder blue / gold heirloom aesthetic, serif headings.

## How submissions are saved
The form works out of the box by saving each signup to the browser's `localStorage`
(so you can demo it immediately). To persist signups to a **real backend/database**:

1. Create a free form endpoint (e.g. [Formspree](https://formspree.io),
   [Getform](https://getform.io), or your own API / Google Sheet webhook).
2. Open `index.html`, find this line near the bottom:
   ```js
   const FORM_ENDPOINT = ""; // <-- paste your form endpoint URL here
   ```
3. Paste your endpoint URL between the quotes. Submissions will then POST there as JSON
   (`firstName, email, phone, smsOptIn, dueOrBirthday, locale, createdAt`) *and* still
   save locally as a fallback.

> Later, point `FORM_ENDPOINT` at your Klaviyo/Mailchimp signup webhook so new contacts
> flow straight into the email/SMS automations from the marketing plan.

## How to preview / deploy
- **Preview locally:** open `index.html` in any browser, or run
  `npx serve marketing/landing` from the repo root.
- **Deploy:** it's static HTML — drop it on Vercel, Netlify, GitHub Pages, or any host.
  (This repo already has `vercel.json` and a GitHub Pages workflow you can adapt.)
