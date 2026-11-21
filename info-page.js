/* info-page.css - Policy and privacy / About us / Terms and conditions */
.doc { padding: 18px 18px 60px; }
.meta { color: var(--muted); font-size: 13px; margin-bottom: 14px; }
#hero:empty { display: none; }
.hero { display: grid; justify-items: center; gap: 8px; text-align: center; padding: 6px 0 18px; }
.hero .logo { width: 76px; height: 76px; border-radius: 22px; font-size: 32px; }
.hero h2 { font-size: 22px; letter-spacing: -.3px; }
.hero p { color: var(--soft); font-size: 14px; }
#content { display: grid; gap: 12px; }
#content h3 { font-size: 17px; margin-top: 10px; letter-spacing: -.2px; }
#content p { color: #33405C; line-height: 1.75; font-size: 15px; word-break: break-word; }
#content ul { display: grid; gap: 8px; padding-left: 20px; color: #33405C; line-height: 1.6; font-size: 15px; }
#content a, .doc .meta a { color: var(--primary); font-weight: 600; word-break: break-all; }
.contacts { display: grid; gap: 10px; margin-top: 22px; }
.contacts:empty { display: none; }
.contacts h3 { font-size: 16px; margin-bottom: 2px; }
.c-row { display: flex; align-items: center; gap: 12px; background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; font-weight: 600; font-size: 14px; word-break: break-word; }
.c-row .ci { width: 36px; height: 36px; border-radius: 11px; background: var(--primary-soft); display: grid; place-items: center; flex: none; }
.c-row .ci svg { width: 18px; height: 18px; stroke: var(--primary); fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.c-row small { display: block; color: var(--muted); font-weight: 500; font-size: 12px; }
.empty-doc { text-align: center; color: var(--muted); padding: 40px 10px; }
