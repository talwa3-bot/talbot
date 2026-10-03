# זירת הקורס: הנחיה מוכנה ל-Lovable או ל-Base44

**איך משתמשים:**
- **ב-Lovable:** פותחים את הפרויקט הקיים של השאלון החי (https://lovable.dev/projects/cfa38292-e2dd-446b-9855-715fdf5c14d7) ומדביקים את ההנחיה שבהמשך כהודעה אחת.
- **ב-Base44:** פותחים פרויקט חדש ומדביקים את אותה הנחיה.

**כמה קרדיטים צריך:** בתוכנית החינמית של Lovable כנראה יידרשו 2 עד 3 ימים של קרדיטים. טיפ: נרשמים דרך קישור ההפניה שלך מחשבון נוסף ומקבלים קרדיטים.

---

```
Extend this app into "זירת הקורס" – one live companion app for a 4-session Hebrew AI course on Zoom. Keep the existing quiz, join flow, host page (/host, code 2468), dark premium RTL design. Add:

1. Sessions: host picks the active session (1-4). Participants keep the same identity (nickname + localStorage id) across all sessions, and a cumulative course leaderboard sums points from all sessions.

2. Writing challenges ("אתגר כתיבה"): host opens a challenge (title + task text + timer). Participants submit a text answer (e.g. a prompt they wrote). Host clicks "start voting": all submissions appear anonymously as cards; each participant gets 3 votes, cannot vote for their own. Host reveals results with names; each vote = 10 points, top 3 get a bonus of 30/20/10. Host screen shows big cards suitable for screen sharing. Seed these challenges:
 - Session 2: "מייל שמנצח"; "מענה למייל עצבני"; "אפיון העסק שלי במשפט אחד".
 - Session 3: "ערכת מותג"; "הנחיה לתמונת פרופיל"; "תסריט 20 שניות לאווטאר".
 - Session 4: "אוטומציה ראשונה" (describe: when X, then Y).
 Host can add/edit challenges.

3. Showcase draw ("הגרלה"): host opens sign-up; participants tap "אני רוצה להציג" and paste a link. Host sees the list and clicks "הגרל 3" (or any number) with a fun spinning animation, revealing names with their links. Presenters get +30 points. Can redraw.

4. Toolbox ("ארגז הכלים") for participants: tools grouped by session, each with name, one-line Hebrew description, link with copy + open buttons. Host can edit every link from the host page (lecturer referral links). Seed: ChatGPT, Claude, Gemini, Perplexity, NotebookLM, Wispr Flow (session 2); Google Stitch, Gamma, Canva, ElevenLabs, HeyGen, D-ID, YouTube Create, Captions (session 3); Make, Lovable, Base44 (session 4). Placeholder URL = tool homepage. Add a small note: "חלק מהקישורים הם קישורי הפניה".

5. Participant navigation tabs: "חידון", "אתגר", "הגרלה", "ארגז הכלים", "טבלה". Whatever the host activates appears automatically (realtime).

6. Small footer on every screen: "© נערך על ידי AI Finance".

Mobile-first, Hebrew RTL, fast, no login.
```
