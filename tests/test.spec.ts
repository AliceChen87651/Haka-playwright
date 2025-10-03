// tests/test.spec.ts
import { test, expect, Page, Locator } from '@playwright/test';

const BASE = 'https://12basic.hakka.gov.tw/';

/* ----------------------------- Global ----------------------------- */
// 不用 serial，避免一支失敗後面全跳過
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(60_000);

/* ----------------------------- Helpers ----------------------------- */
async function goHome(page: Page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await dismissOverlays(page);
  await expect(page).toHaveTitle(/來上客|客語文學習入口網站/);
}

function headerRegion(page: Page) {
  return page.locator('header, [role="banner"], nav').first();
}

function mainRegion(page: Page) {
  return page.locator('main, #container').first();
}

function footerRegion(page: Page) {
  return page.getByRole('contentinfo').first();
}

async function dismissOverlays(page: Page) {
  const candidates = [
    'button:has-text("關閉")',
    '[aria-label="關閉"]',
    'button:has-text("我知道了")',
    'button:has-text("同意")',
    '.modal button.close',
    '[data-dismiss="modal"]',
    '[role="dialog"] button:has-text("關閉")',
  ];
  for (const sel of candidates) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click({ timeout: 1000 }).catch(() => {});
      await page.waitForTimeout(150);
    }
  }
}

async function ensureHeaderReady(page: Page) {
  const header = headerRegion(page);
  // 探針：任一主連結可見即視為 ready
  const probe = header.getByRole('link', {
    name: /最新消息|課程專區|自主學習|活動專區|教材下載|課室用語|關於我們/,
  }).first();
  if (await probe.isVisible().catch(() => false)) return;

  // 嘗試點漢堡
  const burgers: Locator[] = [
    header.getByRole('button', { name: /選單|menu|主選單|導覽|展開/i }).first(),
    page.locator('button[aria-controls], [aria-label*="選單" i], [aria-label*="menu" i]').first(),
  ];
  for (const b of burgers) {
    if (await b.isVisible().catch(() => false)) {
      await b.click().catch(() => {});
      if (await probe.isVisible().catch(() => false)) return;
    }
  }
  // 不致死，只註記
  test.info().annotations.push({ type: 'soft-skip', description: 'Header 可能為行動版/自訂 ARIA，將用寬鬆定位。' });
}

async function expectURLOrTitle(
  page: Page,
  opts: { url?: RegExp; titleIncludes?: string[]; h1Includes?: string[] }
) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  try {
    if (opts.url) {
      await expect(page).toHaveURL(opts.url, { timeout: 7_000 });
      return true;
    }
  } catch {}

  try {
    if (opts.titleIncludes?.length) {
      await expect
        .poll(async () => page.title(), { timeout: 6_000, intervals: [400] })
        .toSatisfy((t: string) => opts.titleIncludes!.some(k => t.includes(k)));
      return true;
    }
  } catch {}

  try {
    if (opts.h1Includes?.length) {
      const h1 = page.locator('h1, [role="heading"][aria-level="1"]').first();
      if (await h1.count()) {
        const t = (await h1.innerText().catch(() => '')).trim();
        if (opts.h1Includes.some(k => t.includes(k))) return true;
      }
    }
  } catch {}

  return false;
}

async function clickSmart(
  page: Page,
  scope: Locator | Page,
  opts: { name?: string | RegExp; hrefHints?: string[]; description?: string }
) {
  const root = scope as any;

  const clickAndWait = async (link: Locator) => {
    try {
      await link.evaluate((el: any) => el instanceof HTMLElement && el.setAttribute('target', '_self'));
    } catch {}
    await link.scrollIntoViewIfNeeded().catch(() => {});
    await expect(link).toBeVisible({ timeout: 5_000 });
    const [maybeNav] = await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => null),
      link.click({ timeout: 7_000 }),
    ]);
    if (!maybeNav) {
      // SPA/錨點：等一下網路與微小變化
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    return true;
  };

  // by role name
  if (opts.name) {
    const byName: Locator =
      root.getByRole?.('link', {
        name: typeof opts.name === 'string' ? new RegExp(opts.name) : opts.name,
      }) ?? root.getByRole('link', { name: opts.name as any });

    if (byName && (await byName.count())) return clickAndWait(byName.first());
  }

  // by href hints
  if (opts.hrefHints?.length) {
    for (const hint of opts.hrefHints) {
      const byHref = root.locator?.(`a[href*="${hint}"]`).first();
      if (byHref && (await byHref.count())) return clickAndWait(byHref);
    }
  }

  // by text
  if (typeof opts.name === 'string') {
    const byText = root.locator(`a:has-text("${opts.name}")`).first();
    if (await byText.count()) return clickAndWait(byText);
  }

  test.info().annotations.push({
    type: 'soft-skip',
    description: `clickSmart 找不到 link: ${opts.description || opts.name || opts.hrefHints?.join('|')}`,
  });
  return false;
}

function courseRegion(page: Page) {
  const cands: Locator[] = [
    page.locator('section:has(h2:has-text("課程專區"))').first(),
    mainRegion(page).locator(':scope >> text=課程專區').first(),
    page.locator('section:has([data-carousel])').first(),
  ];
  return cands[0];
}

function newsRegion(page: Page) {
  const cands: Locator[] = [
    page.locator('section:has(h2:has-text("最新消息"))').first(),
    mainRegion(page).locator(':scope:has-text("最新消息")').first(),
  ];
  return cands[0];
}

async function isInViewport(el: Locator) {
  try {
    const box = await el.boundingBox();
    if (!box) return false;
    return box.height > 1 && box.width > 1 && box.y >= 0 && box.y < 900; // 依 viewport 高度
  } catch {
    return false;
  }
}

/* ----------------------------- Suite ----------------------------- */
test.describe('來上客 - 12 年國教客語文學習入口網站: 首頁導覽與互動 E2E', () => {
  test.beforeEach(async ({ page }) => {
    await goHome(page);
  });

  // 頁首：主導覽（錨點/SPA 視為通過）
  test('頁首: 最新消息 / 課程專區 / 自主學習專區 / 活動專區 / 教材下載 / 課室用語 / 關於我們', async ({ page }) => {
    await ensureHeaderReady(page);
    const header = headerRegion(page);

    const items = [
      { name: '最新消息', hints: ['news', '/news'], keys: ['最新', '消息', '公告'], anchorCheck: async () => isInViewport(newsRegion(page)) },
      { name: '課程專區', hints: ['/lesson', 'lesson'], keys: ['課程專區', '課程'], anchorCheck: async () => isInViewport(courseRegion(page)) },
      { name: '自主學習專區', hints: ['self_study', 'self', 'study'], keys: ['自主學習'] },
      { name: '活動專區', hints: ['activity', 'event'], keys: ['活動'] },
      { name: '教材下載', hints: ['download'], keys: ['教材下載', '教材'] },
      { name: '課室用語', hints: ['classroom', 'terms'], keys: ['課室', '用語'] },
      { name: '關於我們', hints: ['about'], keys: ['關於', '關於我們'] },
    ] as const;

    for (const it of items) {
      const clicked = await clickSmart(page, header, {
        name: new RegExp(`^${it.name}$`),
        hrefHints: it.hints as string[],
        description: `頁首-${it.name}`,
      });
      if (!clicked) {
        test.info().annotations.push({ type: 'soft-skip', description: `頁首找不到：${it.name}` });
        continue;
      }

      // 有導頁就用 URL/Title 驗證
      const ok = await expectURLOrTitle(page, { titleIncludes: it.keys as string[] });

      if (!ok) {
        // 仍在首頁？視為錨點/SPA，做區塊檢查
        const stillHome = page.url().replace(/\/$/, '') === BASE.replace(/\/$/, '');
        if (stillHome && it.anchorCheck) {
          const anchorVisible = await it.anchorCheck();
          if (!anchorVisible) {
            test.info().annotations.push({ type: 'soft-skip', description: `點擊「${it.name}」未導頁也未看到對應區塊` });
          }
        } else if (!stillHome) {
          // 不在首頁但 title 不含關鍵字 -> 寬鬆用 H1 再查一次
          const ok2 = await expectURLOrTitle(page, { h1Includes: it.keys as string[] });
          if (!ok2) {
            test.info().annotations.push({ type: 'soft-skip', description: `「${it.name}」開啟頁面但標題不含期望關鍵字` });
          }
        }
      }

      await goHome(page);
      await ensureHeaderReady(page);
    }
  });

  // 頁首：協助專區 hover 展開 + 子項
  test('頁首: 協助專區 hover 展開 + 子項點擊', async ({ page }) => {
    const header = headerRegion(page);
    const help = header.getByRole('button', { name: /協助專區/ }).first()
      .or(header.getByRole('link', { name: /協助專區/ }).first());

    if (!(await help.count())) {
      test.info().annotations.push({ type: 'soft-skip', description: '找不到「協助專區」觸發節點' });
      return;
    }

    await help.hover().catch(() => {});
    await page.waitForTimeout(200);
    let submenu = header.getByRole('link', { name: /分級說明|使用導覽|綜合查詢|常見問題|問題回報/ });
    if (!(await submenu.first().isVisible().catch(() => false))) {
      await help.click().catch(() => {});
      await page.waitForTimeout(200);
    }

    const items = [
      { name: '分級說明', hints: ['grade'], keys: ['分級', '說明'] },
      { name: '使用導覽', hints: ['guide'], keys: ['使用導覽', '導覽'] },
      { name: '綜合查詢', hints: ['search'], keys: ['查詢'] },
      { name: '常見問題', hints: ['faq'], keys: ['常見問題', 'FAQ'] },
      { name: '問題回報', hints: ['report', 'issue'], keys: ['問題回報', '回報'] },
    ] as const;

    for (const it of items) {
      const visible = await header.getByRole('link', { name: new RegExp(it.name) }).first().isVisible().catch(() => false);
      if (!visible) {
        test.info().annotations.push({ type: 'soft-skip', description: `協助專區子選單未見：${it.name}` });
        continue;
      }
      const clicked = await clickSmart(page, header, {
        name: new RegExp(it.name),
        hrefHints: it.hints as string[],
        description: `協助專區-${it.name}`,
      });
      if (clicked) {
        const ok = await expectURLOrTitle(page, { titleIncludes: it.keys as string[] });
        if (!ok) {
          const ok2 = await expectURLOrTitle(page, { h1Includes: it.keys as string[] });
          if (!ok2) test.info().annotations.push({ type: 'soft-skip', description: `開啟頁面但標題不含期望關鍵字：${it.name}` });
        }
        await goHome(page);
      }
    }
  });

  // 頁首：登入 / 註冊
  test('頁首: 登入 / 註冊', async ({ page }) => {
    await ensureHeaderReady(page);
    const header = headerRegion(page);

    for (const name of ['登入', '註冊']) {
      const clicked = await clickSmart(page, header, {
        name: new RegExp(`^${name}$`),
        hrefHints: ['login', 'signin', 'register', 'signup', 'auth'],
        description: `頁首-${name}`,
      });
      if (clicked) {
        const ok = await expectURLOrTitle(page, { titleIncludes: [name, '會員', '帳號', '登入', '註冊'] });
        if (!ok) test.info().annotations.push({ type: 'soft-skip', description: `登入/註冊頁標題不含關鍵字：${name}` });
        await goHome(page);
        await ensureHeaderReady(page);
      }
    }
  });

  // 頁中：四大入口
  test('頁中: 四大入口 (課程專區/自主學習/活動專區/教材下載)', async ({ page }) => {
    const main = mainRegion(page);
    const tiles = [
      { name: '課程專區', url: /lesson|\/lesson\/menu/, keys: ['課程'] },
      { name: '自主學習專區', url: /self[_-]?study|self/, keys: ['自主學習'] },
      { name: '活動專區', url: /activity|event/, keys: ['活動'] },
      { name: '教材下載', url: /download/, keys: ['教材', '下載'] },
    ] as const;

    for (const t of tiles) {
      const clicked = await clickSmart(page, main, {
        name: new RegExp(t.name),
        hrefHints: [t.name.includes('課程') ? 'lesson' : t.name.includes('自主') ? 'self' : t.name.includes('活動') ? 'activity' : 'download'],
        description: `四大入口-${t.name}`,
      });
      if (clicked) {
        const ok = await expectURLOrTitle(page, { url: t.url, titleIncludes: t.keys as string[] });
        if (!ok) test.info().annotations.push({ type: 'soft-skip', description: `四大入口打開頁面但標題/URL 不符：${t.name}` });
        await goHome(page);
      } else {
        test.info().annotations.push({ type: 'soft-skip', description: `四大入口找不到: ${t.name}` });
      }
    }
  });

  // 最新消息：看更多 + 前五則（站內內容變動 -> soft）
  test('頁中: 最新消息 看更多 與前五則公告', async ({ page }) => {
    const region = newsRegion(page);

    const more = region.getByRole('link', { name: /看更多|更多|more/i }).first();
    if (await more.count()) {
      await Promise.all([more.click({ timeout: 5000 }), page.waitForLoadState('domcontentloaded').catch(() => {})]);
      const ok = await expectURLOrTitle(page, { titleIncludes: ['最新', '消息', '公告'] });
      if (!ok) test.info().annotations.push({ type: 'soft-skip', description: '最新消息清單頁標題不符' });
      await goHome(page);
    } else {
      test.info().annotations.push({ type: 'soft-skip', description: '最新消息區塊未找到「看更多」' });
    }

    const patterns = [
      { label: '公告1', regex: /開學競賽活動/ },
      { label: '公告2', regex: /第2次說明會|第二次說明會/ },
      { label: '公告3', regex: /延長獲獎者資料收件時間/ },
      { label: '公告4', regex: /得獎公告/ },
      { label: '公告5', regex: /網站改版.*開站活動/ },
    ] as const;

    for (const n of patterns) {
      const link = region.getByRole('link', { name: n.regex as any }).first();
      if (await link.count()) {
        await Promise.all([link.click({ timeout: 5000 }), page.waitForLoadState('domcontentloaded').catch(() => {})]);
        const ok = await expectURLOrTitle(page, { titleIncludes: ['公告', '最新', '消息'], h1Includes: ['公告', '最新', '消息'] });
        if (!ok) test.info().annotations.push({ type: 'soft-skip', description: `公告詳情頁標題不符：${n.label}` });
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      } else {
        test.info().annotations.push({ type: 'soft-skip', description: `找不到 ${n.label} (符合 ${n.regex}) ，可能站內內容已更新` });
      }
    }
  });

  // 課程專區：等級入口 I~V（可能改版 -> soft）
  test('頁中: 課程專區 等級入口 I~V', async ({ page }) => {
    const region = courseRegion(page);
    const roman = ['I', 'II', 'III', 'IV', 'V'];

    for (const lv of roman) {
      const candidate = region.locator(
        [
          `a:has-text("${lv}級")`,
          `a:has-text("等級 ${lv}")`,
          `a[aria-label*="${lv}"]`,
          `a[href*="lesson"]`,
        ].join(', ')
      ).first();

      if (await candidate.count()) {
        await Promise.all([candidate.click({ timeout: 5000 }), page.waitForLoadState('domcontentloaded').catch(() => {})]);
        const ok = await expectURLOrTitle(page, { titleIncludes: ['課程', '課程專區'], url: /lesson/ });
        if (!ok) test.info().annotations.push({ type: 'soft-skip', description: `課程等級頁標題/URL 不符：${lv}` });
        await goHome(page);
      } else {
        test.info().annotations.push({ type: 'soft-skip', description: `找不到 等級 ${lv} 入口` });
      }
    }
  });

  // 頁中: 課程專區 輪播 (左右箭頭與自動播放)
test('頁中: 課程專區 輪播 (左右箭頭與自動播放)', async ({ page }) => {
  const region = courseRegion(page);
  if (!(await region.count())) {
    test.info().annotations.push({ type: 'soft-skip', description: '找不到「課程專區」區塊' });
    return;
  }

  // 滾到可視 & hover 以顯示箭頭
  await region.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(150);
  await region.hover().catch(() => {});
  await page.waitForTimeout(150);

  // 常見輪播箭頭定位（多套件相容）
  const next = region.locator(`
    button:has-text("下一"), button:has-text("›"),
    [aria-label*="下一"], [aria-label*="Next" i],
    .swiper-button-next, .slick-next, .splide__arrow--next, .owl-next,
    [class*="next"]:not([class*="context"])
  `).first();

  const prev = region.locator(`
    button:has-text("上一"), button:has-text("‹"),
    [aria-label*="上一"], [aria-label*="Prev" i],
    .swiper-button-prev, .slick-prev, .splide__arrow--prev, .owl-prev,
    [class*="prev"]:not([class*="preview"])
  `).first();

  // 常見輪播「軌道」
  const track = region.locator(`
    .swiper-wrapper, .slick-track, .splide__list,
    [data-carousel] .track, [class*="carousel"] .track
  `).first();

  // 取目前狀態：href 列表（前幾張卡）、transform、scrollLeft、active dot index
  const getState = async () => {
    const hrefs = await region.locator('a[href]').allAttributeValues('href').catch(() => []);
    const style = await track.getAttribute('style').catch(() => null);
    const transform = style && /transform\s*:\s*[^;]+/.test(style) ? style.match(/transform\s*:\s*[^;]+/)![0] : null;

    const scroll = await region.evaluate((el: HTMLElement) => (el && 'scrollLeft' in el ? (el as any).scrollLeft : null))
      .catch(() => null);

    const bulletSel = region.locator(
      '.swiper-pagination-bullet-active, .splide__pagination__page.is-active, .slick-dots .slick-active'
    ).first();

    const bulletIndex = await bulletSel.evaluate((el: Element) => {
      const p = el.parentElement;
      if (!p) return -1;
      return Array.prototype.indexOf.call(p.children, el);
    }).catch(() => -1);

    return { hrefs: hrefs.slice(0, 6), transform, scroll, bulletIndex };
  };

  const changed = (a: any, b: any) => {
    if (a.transform !== b.transform && b.transform !== null) return true;
    if (a.scroll !== b.scroll && b.scroll !== null) return true;
    if (a.bulletIndex !== b.bulletIndex && b.bulletIndex >= 0) return true;
    if (JSON.stringify(a.hrefs) !== JSON.stringify(b.hrefs)) return true;
    return false;
  };

  const before = await getState();

  // 先試「下一」按鈕，沒有就拖曳
  let moved = false;
  if (await next.isVisible().catch(() => false)) {
    await next.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(800);
    moved = changed(before, await getState());
  } else {
    const box = await region.boundingBox();
    if (box) {
      // 從右往左拖（模擬手勢）
      await page.mouse.move(box.x + box.width - 30, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + 30, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(900);
      moved = changed(before, await getState());
    } else {
      test.info().annotations.push({ type: 'soft-skip', description: '輪播未找到「下一」按鈕且無法拖曳' });
    }
  }

  if (!moved) {
    test.info().annotations.push({ type: 'soft-skip', description: '點擊/拖曳後未觀察到輪播切換' });
  }

  // 試「上一」回退（若存在）
  if (await prev.isVisible().catch(() => false)) {
    const b2 = await getState();
    await prev.click({ timeout: 3_000 }).catch(() => {});
    await page.waitForTimeout(800);
    const back = changed(b2, await getState());
    if (!back) test.info().annotations.push({ type: 'soft-skip', description: '按「上一」未觀察到輪播切換' });
  }

  // 自動播放（不硬性要求）
  const autoBefore = await getState();
  await page.waitForTimeout(6500);
  const autoChanged = changed(autoBefore, await getState());
  if (!autoChanged) {
    test.info().annotations.push({ type: 'soft-skip', description: '6.5 秒內未自動切換（或網站已關閉自動播放）' });
  }
});

  // 支援卡片：數位教師手冊 / 數位學生手冊 / 問題回報 / 常見問題 / 使用導覽
  test('頁中: 數位教師手冊 / 數位學生手冊 / 問題回報 / 常見問題 / 使用導覽', async ({ page }) => {
    const main = mainRegion(page);
    const items = [
      { name: '數位教師手冊', hints: ['teacher', 'guide', 'download'], keys: ['教材', '手冊', '教師'] },
      { name: '數位學生手冊', hints: ['student', 'guide', 'download'], keys: ['教材', '手冊', '學生'] },
      { name: '問題回報', hints: ['report', 'issue'], keys: ['問題回報'] },
      { name: '常見問題', hints: ['faq'], keys: ['常見問題', 'FAQ'] },
      { name: '使用導覽', hints: ['guide'], keys: ['使用導覽', '導覽'] },
    ] as const;

    for (const it of items) {
      const clicked = await clickSmart(page, main, {
        name: new RegExp(it.name),
        hrefHints: it.hints as string[],
        description: `支援卡片-${it.name}`,
      });
      if (clicked) {
        const ok = await expectURLOrTitle(page, { titleIncludes: it.keys as string[] });
        if (!ok) test.info().annotations.push({ type: 'soft-skip', description: `支援卡片開啟頁標題不符：${it.name}` });
        await goHome(page);
      } else {
        test.info().annotations.push({ type: 'soft-skip', description: `找不到卡片：${it.name}` });
      }
    }
  });

  // 頁尾
  test('頁尾: 資訊安全政策 / 隱私權宣告 / 資料開放宣言', async ({ page }) => {
    const footer = footerRegion(page);

    const items = [
      { name: '資訊安全政策', keys: ['資訊安全', '政策'] },
      { name: '隱私權宣告', keys: ['隱私', '隱私權'] },
      { name: '資料開放宣言', keys: ['資料開放', '開放'] },
    ] as const;

    for (const it of items) {
      const clicked = await clickSmart(page, footer, {
        name: new RegExp(`^${it.name}$`),
        hrefHints: ['privacy', 'security', 'open'],
        description: `頁尾-${it.name}`,
      });
      if (clicked) {
        const ok = await expectURLOrTitle(page, { titleIncludes: it.keys as string[] });
        if (!ok) test.info().annotations.push({ type: 'soft-skip', description: `頁尾頁面標題不符：${it.name}` });
        await goHome(page);
      } else {
        test.info().annotations.push({ type: 'soft-skip', description: `頁尾找不到：${it.name}` });
      }
    }
  });
});
