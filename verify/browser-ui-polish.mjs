import assert from 'node:assert/strict';
import path from 'node:path';

export async function settleVisualState(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const transitions = document.getAnimations().filter(animation => {
      const timing = animation.effect?.getComputedTiming();
      return timing && Number.isFinite(timing.endTime);
    });
    await Promise.all(transitions.map(animation => animation.finished.catch(() => {})));
  });
}

export async function assertRenderedIcons(page, name) {
  const empty = await page.$$eval('#view svg.icon', nodes => nodes
    .filter(node => !node.childElementCount)
    .map(node => node.closest('button, a')?.textContent.trim() || node.outerHTML));
  assert.deepEqual(empty, [], name + ' has an empty icon');
}

async function assertTaskGeometry(page, description) {
  const rows = await page.$$eval('.task', nodes => nodes.map(node => {
    const box = selector => {
      const rect = node.querySelector(selector).getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    };
    return {
      select: box('.task-select'), title: box('.task__name'), badge: box('.chip'),
      progress: box('[role="progressbar"]'), size: node.querySelector('[data-size]').textContent,
    };
  }));
  assert.ok(rows.length, description + ' contains tasks');
  for (const row of rows) {
    const gap = row.title.left - row.select.right;
    assert.ok(gap >= 4 && gap <= 16, description + ' title immediately follows selection');
    assert.ok(row.badge.left >= row.title.right - 1, description + ' badge does not overlap title');
    assert.equal(Math.round(row.select.width), 18, description + ' selection stays compact');
    assert.ok(row.progress.width >= 100, description + ' progress remains readable');
    if (page.viewport().width <= 860) assert.ok(row.title.height <= 42, description + ' long title stays within two lines');
    assert.ok(!row.size.includes('%'), description + ' does not repeat progress in size');
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, description + ' overflows');
}

export async function verifyTaskPolish(page, { out, record }) {
  const viewport = page.viewport();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.evaluate(() => { location.hash = '#/tasks'; });
  await page.waitForSelector('.task__name');
  const titles = await page.$$eval('.task__name', nodes => nodes.map(node => node.textContent));
  for (const mode of ['dark', 'light']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, mode);
    for (const width of [1440, 1024, 861, 768, 390, 360, 320]) {
      await page.setViewport({ width, height: 1000 });
      await settleVisualState(page);
      await assertTaskGeometry(page, mode + ' ' + width);
      await page.$$eval('.task__name', nodes => nodes.forEach(node => {
        node.textContent = 'Long.Release.' + 'VeryLongUnbrokenName'.repeat(8) + '.S01E02.2160p.WEB-DL.H265';
      }));
      await assertTaskGeometry(page, mode + ' ' + width + ' long name');
      if (width === 390) await page.screenshot({ path: path.join(out, 'tasks-' + mode + '-long-name-mobile.png') });
      await page.$$eval('.task__name', (nodes, names) => nodes.forEach((node, index) => { node.textContent = names[index]; }), titles);
    }
  }
  await page.setViewport(viewport);
  await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
  record('task titles align with selection without badge overlap in 28 theme/width/name combinations');
}
