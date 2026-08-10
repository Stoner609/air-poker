import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test("主選單可前往教學、設定與重播", async ({ page }) => {
  await page.getByRole("button", { name: "教學" }).click();
  await expect(page.getByRole("heading", { name: "訓練協定" })).toBeVisible();
  for (let step = 0; step < 4; step += 1) {
    await page.getByRole("button", { name: "下一步" }).click();
  }
  await page.getByRole("button", { name: "完成教學" }).click();

  await page.getByRole("button", { name: "設定" }).click();
  await expect(page.getByRole("heading", { name: "系統設定" })).toBeVisible();
  await page.getByRole("button", { name: "返回主選單" }).click();

  await page.getByRole("button", { name: "重播／匯入紀錄" }).click();
  await expect(page.getByRole("heading", { name: "對局檔案庫" })).toBeVisible();
});

test("離開進行中的對局後可從本機存檔繼續", async ({ page }) => {
  await page.getByRole("button", { name: "新對局" }).click();
  await expect(page.getByRole("heading", { name: "開場檢視" })).toBeVisible();
  await page.getByRole("button", { name: "稍後繼續" }).click();

  const continueButton = page.getByRole("button", { name: "繼續對局" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByRole("heading", { name: "開場檢視" })).toBeVisible();
});

test("可完成五局 AI 對局並產生結果報告", async ({ page }) => {
  test.setTimeout(45_000);
  await page.getByRole("button", { name: "新對局" }).click();
  await expect(page.getByRole("heading", { name: "開場檢視" })).toBeVisible();
  await page.getByRole("button", { name: "開始第一局" }).click();

  for (let round = 1; round <= 5; round += 1) {
    if (round < 5) {
      await page.locator('button[aria-label^="選擇目標數字"]:not([disabled])').first().click();
    }

    await expect(page.getByRole("heading", { name: "構築五張牌" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "鎖定預備提交" }).click();

    const fold = page.getByRole("button", { name: /棄牌|棄注/ });
    await expect(fold).toBeVisible({ timeout: 7_000 });
    await fold.click();

    await expect(page.getByRole("heading", { name: `第 ${round} 局揭露` })).toBeVisible();
    if (round === 1) {
      await page.reload();
      await page.getByRole("button", { name: "繼續對局" }).click();
      await expect(page.getByRole("heading", { name: "第 1 局揭露" })).toBeVisible();
      await expect(page.getByRole("list", { name: "YOU 當局 BIOS 下注籌碼" })).toContainText("底 1");
    }
    await page.getByRole("button", { name: round === 5 ? "查看對局報告" : `進入第 ${round + 1} 局` }).click();

    if (round < 5) {
      await expect(page.locator('[aria-label="YOU 歷史 BIOS 投入"] [role="listitem"]')).toHaveCount(round);
      await expect(page.locator('[aria-label="AI // NEMESIS 歷史 BIOS 投入"] [role="listitem"]')).toHaveCount(round);
    }
  }

  await expect(page.getByText("MATCH COMPLETE")).toBeVisible();
  await expect(page.getByRole("button", { name: "匯出完整 JSON" })).toBeVisible();
  await expect(page.getByRole("list", { name: "歷史 BIOS 投入摘要" }).locator('[role="listitem"]')).toHaveCount(5);
  for (let round = 1; round <= 5; round += 1) {
    await expect(page.getByRole("listitem", { name: `第 ${round} 局 BIOS 投入摘要` })).toBeVisible();
  }

  const exported = await page.evaluate(() => {
    const records = JSON.parse(localStorage.getItem("air-poker:completed-matches:v1") ?? "[]");
    return JSON.stringify(records[0]);
  });
  await page.getByRole("button", { name: "返回主選單" }).click();
  await page.evaluate(() => localStorage.removeItem("air-poker:completed-matches:v1"));
  await page.getByRole("button", { name: "重播／匯入紀錄" }).click();
  await expect(page.getByText(/尚無完成的對局紀錄/)).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "air-poker-replay.json",
    mimeType: "application/json",
    buffer: Buffer.from(exported),
  });
  await expect(page.getByText(/EVENT \d+ \/ \d+/)).toBeVisible();
  await expect(page.getByText(/組牌軌跡/).first()).toBeVisible();
});

test("1024x768 與 1280x720 下籌碼面板與下注控制不水平溢位", async ({ page }) => {
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.getByRole("button", { name: "新對局" }).click();
    await page.getByRole("button", { name: "開始第一局" }).click();

    await expect(page.getByRole("heading", { name: "選擇本局數字" })).toBeVisible();
    for (const label of ["YOU", "AI // NEMESIS"]) {
      const rail = page.getByRole("list", { name: `${label} 當局 BIOS 下注籌碼` });
      await expect(rail).toBeVisible();
      await expect(rail).toHaveAttribute("data-rail-layout", "two-rows");
    }
    const leftRail = page.getByRole("list", { name: "YOU 當局 BIOS 下注籌碼" });
    const rightRail = page.getByRole("list", { name: "AI // NEMESIS 當局 BIOS 下注籌碼" });
    const [leftRailBox, leftChipBox, rightRailBox, rightChipBox] = await Promise.all([
      leftRail.boundingBox(),
      leftRail.getByRole("listitem").first().boundingBox(),
      rightRail.boundingBox(),
      rightRail.getByRole("listitem").first().boundingBox(),
    ]);
    expect(leftRailBox).not.toBeNull();
    expect(leftChipBox).not.toBeNull();
    expect(rightRailBox).not.toBeNull();
    expect(rightChipBox).not.toBeNull();
    expect(Math.abs(leftRailBox!.x + leftRailBox!.width - leftChipBox!.x - leftChipBox!.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(rightChipBox!.x - rightRailBox!.x)).toBeLessThanOrEqual(1);
    const selectionLayout = await page.evaluate(() => ({
      viewport: (globalThis as unknown as { innerWidth: number }).innerWidth,
      scrollWidth: (globalThis as unknown as { document: { documentElement: { scrollWidth: number } } }).document.documentElement.scrollWidth,
    }));
    expect(selectionLayout.scrollWidth).toBeLessThanOrEqual(selectionLayout.viewport);

    await page.locator('button[aria-label^="選擇目標數字"]:not([disabled])').first().click();
    await expect(page.getByRole("heading", { name: "構築五張牌" })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: "鎖定預備提交" }).click();
    const fold = page.getByRole("button", { name: /棄牌|棄注/ });
    await expect(fold).toBeVisible({ timeout: 7_000 });
    expect(await fold.boundingBox()).not.toBeNull();

    const bettingLayout = await page.evaluate(() => ({
      viewport: (globalThis as unknown as { innerWidth: number }).innerWidth,
      scrollWidth: (globalThis as unknown as { document: { documentElement: { scrollWidth: number } } }).document.documentElement.scrollWidth,
    }));
    expect(bettingLayout.scrollWidth).toBeLessThanOrEqual(bettingLayout.viewport);
  }
});
