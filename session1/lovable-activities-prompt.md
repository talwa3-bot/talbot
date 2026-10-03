# הרחבת השאלון החי: הנחיה להדבקה ב-Lovable

כשיתחדשו הקרדיטים בחשבון ה-Lovable, פותחים את הפרויקט "QuizFlow AI" ב-lovable.dev, מדביקים את ההנחיה שלמטה בצ'אט ושולחים. אחרי שהבנייה מסתיימת לוחצים Publish.

---

Great work. Now turn the quiz into a full LIVE ACTIVITIES app for the lecture: the host steps through a sequence of mixed activities (same host controls: next, previous, reveal results, end, reset). Keep the design, RTL Hebrew, realtime, connected-people strip, host code and leaderboard exactly as they are.

## Activity types (one config file, src/config/activities.ts, replacing questions.ts)
1. quiz: question, 2-4 answers, correct answer, 20s timer, points (as today). Only quiz activities give points.
2. poll: single choice, 2-6 options, no correct answer, no timer, no points. Results = live bar chart with percentages.
3. multi: multiple choice ("סמנו את כל מה שמתאים"), 2-6 options, results = bar chart of how many picked each.
4. wordcloud: each participant can send up to 3 short words/phrases (max 25 chars each). Results = an animated live word cloud where repeated words grow bigger. The host screen shows the cloud updating live.
5. scale: rate 1 to 5 with big emoji buttons (😟 🙁 😐 🙂 🤩). Results = distribution bars and the average. If the activity has "compareWith" (id of an earlier scale activity), show both averages side by side: "בהתחלה: X · עכשיו: Y" with a celebratory animation if it went up.
6. opentext: free text up to 120 chars, one submission per person. Results = a "wall" of cards with the text and nickname; host can click a card to highlight it big.

Every activity shows a small type label (e.g. "🧠 חידון", "📊 סקר", "☁️ ענן מילים", "⭐ דירוג", "💬 קיר רעיונות"). Host screen shows "פעילות X מתוך 30" and the live count "השיבו: X מתוך N".

## The sequence (exactly in this order)
1. scale (id: start_confidence): "כמה אתם מרגישים בנוח עם AI היום?"
2. wordcloud: "מילה אחת שעולה לכם כשאתם שומעים 'בינה מלאכותית'"
3. quiz: "שלושה טקסטים על המסך. כמה מהם נכתבו על ידי AI?" | אף אחד | אחד | שניים | שלושה | correct 4
4. quiz: "איזה מהבאים לא משתמש ב-AI?" | וויז | סינון ספאם בג'ימייל | מחשבון רגיל בטלפון | זיהוי פנים בטלפון | correct 3
5. wordcloud: "השלימו את המשפט: בוקר טוב, מה ___"
6. quiz: "מה מודל שפה עושה בעצם?" | מחפש תשובות בגוגל | מנבא את המילה הבאה הסבירה ביותר | שולף עובדות ממאגר מידע | מבין בדיוק כמו בן אדם | correct 2
7. quiz: "כמה זמן לקח לצ'אט ג'יפיטי להגיע למיליון משתמשים?" | 5 ימים | חודש | חצי שנה | שנה | correct 1
8. quiz: "מה ההבדל המרכזי בין גוגל ל-AI?" | גוגל מוצא דפים, AI מייצר תשובה חדשה | אין שום הבדל | AI תמיד צודק, גוגל לא | גוגל כותב טקסטים חדשים | correct 1
9. multi: "עם אילו כלים כבר עבדתם?" | צ'אט ג'יפיטי | קלוד | ג'מיני | קופיילוט | דיפסיק | אף אחד עדיין
10. quiz: "איזה כלי משולב ישירות בוורד, אקסל וטימס?" | ג'מיני | קופיילוט | דיפסיק | קלוד | correct 2
11. quiz: "איפה עשוי להישמר מידע שמזינים לאתר של דיפסיק?" | בישראל | באירופה | בסין | לא נשמר בכלל | correct 3
12. quiz: "איזה כלי הכי מתאים לנתח חוזה של 40 עמודים?" | קלוד | מידג'רני | Suno | קופיילוט החינמי | correct 1
13. poll: "קרב כלים, סיבוב 1 (סיכום מסמך): מי ניצח?" | קלוד | צ'אט ג'יפיטי
14. poll: "קרב כלים, סיבוב 2 (מידע עדכני): מי ניצח?" | ג'מיני | Perplexity
15. poll: "קרב כלים, סיבוב 3 (יצירת תמונה): מי ניצח?" | צ'אט ג'יפיטי | ג'מיני
16. quiz: "מה המסקנה מקרב הכלים?" | יש כלי אחד שמנצח בהכול | לכל משימה יש כלי שמתאים לה | כל הכלים זהים | הכלי היקר תמיד הכי טוב | correct 2
17. poll: "איזו משימה הייתם רוצים לעשות עם AI כבר מחר?" | מייל רגיש ללקוח | ניתוח חוזה ארוך | סיכום פגישה | תמונה לפוסט | ללמוד מהמסמכים שלי | מצגת בדקה
18. opentext: "תארו במשפט אחד תמונה שהייתם רוצים ש-AI ייצור לכם"
19. quiz: "איזה כלי יוצר שיר שלם עם מילים ולחן?" | Gamma | Perplexity | Suno | Canva | correct 3
20. quiz: "איזה כלי הופך את המסמכים שלכם לפודקאסט?" | NotebookLM | Suno | Perplexity | Gamma | correct 1
21. opentext: "הציעו נושא לשיר על הקורס שלנו (ה-AI ישיר אותו!)"
22. poll: "תרגיל 2: מי ניצח אצלכם?" | צ'אט ג'יפיטי | קלוד | ג'מיני | תיקו
23. quiz: "AI ענה בביטחון מלא על תאריך היסטורי. מה עושים?" | סומכים עליו | מאמתים במקור נוסף | שואלים אותו שוב ומעתיקים | מפרסמים מהר | correct 2
24. quiz: "טעיתם, וה-AI מסכים איתכם בכל זאת. איך קוראים לזה?" | הזיה | חנפנות | הטיה | ידע לא עדכני | correct 2
25. quiz: "לפי תיקון 13, אפשר לתבוע על הפרת פרטיות בלי להוכיח נזק?" | כן | לא | correct 1
26. opentext: "מה עוד לא הייתם מזינים לצ'אט של AI?"
27. quiz: "מה מהבאים מותר להזין לצ'אט?" | סיסמה למערכת בעבודה | תעודת זהות של לקוח | טיוטת מייל בלי פרטים מזהים | תיק רפואי של עובד | correct 3
28. multi: "מה הכי מעניין אתכם לבנות בקורס?" | עוזר אישי משלי | מצגת בדקות | תמונות ממותגות | פודקאסט מהמסמכים | שיר או ג'ינגל | מיני-אפליקציה
29. scale (compareWith: start_confidence): "ועכשיו, אחרי המפגש: כמה אתם מרגישים בנוח עם AI?"
30. poll: "מה היה הכי מגניב היום?" | השיר שנוצר | הפודקאסט | משחק הטריוויה | קרב הכלים | החתול האסטרונאוט

Make sure opentext and wordcloud inputs are trimmed, empty submissions are ignored, and a participant who joins mid-session lands on the current activity.
