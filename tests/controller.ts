import { expect, Page, Locator } from '@playwright/test';
import assert from "assert";

function exactText(text: string): RegExp {
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
}

export class Controller {
  private _page: Page;

  constructor(page: Page) {
    assert(page);
    this._page = page;
  }

  async login(login: string | undefined, password: string | undefined) {
    assert(process.env.baseURL);
    assert(login);
    assert(password);

    await this._page.goto(process.env.baseURL);
    await this._page.fill("#loginEdit-el", login);
    await this._page.fill("#passwordEdit-el", password);
    await this._page.click("[data-item-marker='btnLogin']");
  }

  async openSectionInWorkplace(workplaceCaption: string | undefined, sectionCaption: string | undefined) {
    assert(workplaceCaption);
    assert(sectionCaption);

    const workplaceButton = this._page.getByRole('button', { name: workplaceCaption, exact: true });
    const section = this._page.getByRole('region', { name: workplaceCaption, exact: true })
      .getByRole('treeitem', { name: sectionCaption, exact: true });
    // The navigation is rebuilt while the operator homepage initializes.
    // Recheck expansion after each render rather than trusting its initial state.
    await expect(async () => {
      if (await workplaceButton.getAttribute('aria-expanded') === 'false') {
        await workplaceButton.click();
      }
      await expect(section).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000, intervals: [500, 1000] });
    await section.click();

    await expect(this._page).toHaveURL(/ViewModule\.aspx/);
  }

  async clickButton(buttonCaption: string | undefined, exact = false) {
    assert(buttonCaption);

    if (exact) {
      await this.button(buttonCaption).click();
      return;
    }

    await this._page
      .locator("[data-item-marker$='Button']", { hasText: buttonCaption })
      .or(this._page.locator("[data-tag$='Button']", { hasText: buttonCaption }))
      .click();
  }

  getColumn(columnCaption: string | undefined) {
    assert(columnCaption);

    return this._page.locator(`.control-wrap div[data-item-marker$=${JSON.stringify(columnCaption)}]`);
  }

  async setColumnValue(columnCaption: string | undefined, columnValue: string | undefined, isLookup: boolean) {
    assert(columnCaption);
    assert(columnValue);

    if (isLookup) {
      // Open the lookup before typing: autocomplete can replace the input's
      // stored name with its normalized caption and seed an incorrect filter.
      await this.openColumnLookup(this.getColumn(columnCaption));
      const lookupGrid = this._page.locator('#grid-grid-wrap');
      // The lookup renderer collapses whitespace in row captions/markers even
      // when the stored name contains repeated spaces. Text matching applies
      // the same normalization without changing the supplied lookup value.
      await lookupGrid.getByText(columnValue, { exact: true }).click();
      await this.clickButton("Выбрать");
      await expect(lookupGrid).toBeHidden();
    } else {
      await this.getColumnInput(columnCaption).fill(columnValue);
    }
  }

  async openColumnLookup(columnLocator: Locator) {
    assert(columnLocator);

    await columnLocator.locator(".base-edit-right-icon-wrapper").click();
  }

  getColumnInput(columnCaption: string | undefined) {
    assert(columnCaption);

    return this.getColumn(columnCaption).locator("input");
  }

  label(caption: string): Locator {
    return this._page.locator('.label-wrap:visible label').filter({ hasText: exactText(caption) });
  }

  control(caption: string): Locator {
    const labelWrap = this._page.locator('.label-wrap:visible').filter({
      has: this._page.locator('label').filter({ hasText: exactText(caption) }),
    });
    return labelWrap.locator('xpath=following-sibling::div[contains(@class,"control-wrap")][1]');
  }

  input(caption: string): Locator {
    return this.control(caption).locator('input:not([type="checkbox"]), textarea:not(.virtual)').first();
  }

  button(caption: string): Locator {
    const modal = this._page.locator('.ts-modalbox:visible');
    const scope = modal.last().or(this._page.locator('body').filter({ hasNot: modal }));
    if (caption === 'Поиск') {
      return scope.locator('.t-btn-wrapper[data-tag="SearchButton"]:visible');
    }
    return scope.locator('.t-btn-wrapper:visible')
      .filter({ hasText: new RegExp(exactText(caption).source, 'i') });
  }

  async openSection(caption: string): Promise<void> {
    await this._page.getByRole('treeitem', { name: caption, exact: true }).click();
    await expect(this._page).toHaveTitle(caption);
  }

  async openTab(caption: string): Promise<void> {
    await this._page.locator('.ts-tabpanel-items:visible > li')
      .filter({ hasText: exactText(caption) }).click();
  }

  async clearSectionFilters(): Promise<void> {
    // Wait for the filter bar to finish loading the user's saved filters.
    await expect(this._page.locator('[data-item-marker="TagFilterAddButton"]')).toBeVisible();
    const removeButtons = this._page.locator('.filter-remove-button:visible');
    while (await removeButtons.count() > 0) {
      const count = await removeButtons.count();
      await removeButtons.first().click();
      await expect(removeButtons).toHaveCount(count - 1);
    }
  }

  async expectRequired(caption: string, required: boolean): Promise<void> {
    await expect(this.label(caption)).toBeVisible();
    if (required) {
      await expect(this.label(caption)).toHaveClass(/\bt-label-is-required\b/);
    } else {
      await expect(this.label(caption)).not.toHaveClass(/\bt-label-is-required\b/);
    }
  }

  async fill(caption: string, value: string): Promise<void> {
    await this.input(caption).fill(value);
    await this.input(caption).press('Tab');
    await expect(this.input(caption)).toHaveValue(value);
  }

  async selectDropdown(caption: string, value: string): Promise<void> {
    await this.control(caption).locator('.base-edit-right-icon-wrapper').click();
    await this._page.locator('li[data-value]:visible').filter({ hasText: exactText(value) }).click();
    await expect(this.input(caption)).toHaveValue(value);
  }

  async fillPhone(value: string): Promise<void> {
    // The UI mask uses country code 7 for Russian numbers supplied with prefix 8.
    const phone = value.replace(/^8(?=\d{10}$)/, '7');
    const input = this.input('Мобильный телефон');
    await input.fill('');
    // The mask supplies the country code; type only the ten national digits.
    await input.pressSequentially(phone.slice(1));
    await input.press('Tab');
    await expect(input).toHaveValue(phone);
  }

  async openLookup(caption: string): Promise<void> {
    await this.control(caption).locator('.base-edit-right-icon-wrapper').click();
    await expect(this._page.locator('#grid-grid-wrap')).toBeVisible();
  }

  async selectLookup(caption: string, value: string): Promise<void> {
    await this.openLookup(caption);
    const grid = this._page.locator('#grid-grid-wrap');
    await grid.getByText(value, { exact: true }).click();
    await this.clickButton('Выбрать', true);
    await expect(grid).toBeHidden();
    await expect(this.input(caption)).toHaveValue(value);
  }

  async fillEventDate(value: Date): Promise<void> {
    const controls = this.control('Дата события').locator('input');
    const date = value.toLocaleDateString('ru-RU');
    const time = value.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    await controls.nth(0).fill(date);
    await controls.nth(0).press('Tab');
    await controls.nth(1).fill(time);
    await controls.nth(1).press('Tab');
    await expect(controls.nth(0)).toHaveValue(date);
    await expect(controls.nth(1)).toHaveValue(time);
  }

  async save(query: 'InsertQuery' | 'UpdateQuery', confirmDuplicateContact = false): Promise<void> {
    const responsePromise = this._page.waitForResponse(response =>
      response.url().includes(query) && response.request().method() === 'POST');
    const [response] = await Promise.all([
      responsePromise,
      (async () => {
        await this.clickButton('Сохранить', true);
        if (confirmDuplicateContact) {
          // Repeated runs use the specification's fixed contact details.
          // The duplicate review can require a second Save before insertion.
          const duplicateReview = this._page.getByText("Поиск дублей в разделе 'Контакты'", { exact: true });
          const needsConfirmation = await Promise.race([
            responsePromise.then(() => false),
            duplicateReview.waitFor({ state: 'visible' }).then(() => true),
          ]);
          if (needsConfirmation) await this.clickButton('Сохранить', true);
        }
      })(),
    ]);
    expect(response.ok(), `${query} HTTP response`).toBe(true);
    const result = await response.json();
    expect(result.success, `${query} application response`).toBe(true);
  }

  record(number: string): Locator {
    return this._page.locator('.grid-listed-row, .grid-row[data-item-marker]').filter({
      has: this._page.getByText(number, { exact: true }),
    });
  }

  async waitForQueueRecord(number: string, queue: string): Promise<void> {
    let firstAttempt = true;
    await expect(async () => {
      // Queue contents are loaded on entry. If the background job finishes
      // after that request, refresh to fetch the new item on the next attempt.
      if (!firstAttempt) {
        await this._page.reload();
        await this.openTab('Обращения');
      }
      firstAttempt = false;
      const rows = this._page.locator('#grid-QueuePageDataGridGrid-wrap .grid-listed-row');
      await rows.first().waitFor();
      while (await this.record(number).count() === 0) {
        const count = await rows.count();
        await rows.last().scrollIntoViewIfNeeded();
        // Scrolling to the last loaded row requests the next page of the queue.
        const loadedMore = await expect(rows).not.toHaveCount(count, { timeout: 3000 })
          .then(() => true, () => false);
        if (!loadedMore) break;
      }
      if (await this.record(number).count() > 0) {
        await this.record(number).scrollIntoViewIfNeeded();
      }
      await expect(this.record(number), `Complaint ${number} should appear in queue «${queue}»`)
        .toBeVisible({ timeout: 3000 });
      await expect(this.record(number)).toHaveAttribute('data-item-marker', queue);
    }).toPass({ timeout: 60 * 1000, intervals: [5000, 10000] });
  }

  async openRecord(number: string): Promise<void> {
    await this.record(number).getByText(number, { exact: true }).click();
    await expect(this._page).toHaveTitle(new RegExp(`^Обращение №${number}(?:\\s|:|$)`));
    await expect(this._page.locator('[data-item-marker="CasePageContainer"]')).toBeVisible();
  }

  async openQueueRecord(number: string): Promise<void> {
    await this.record(number).locator('button.grid-row-actions-button').click();
    await this._page.getByText('Открыть', { exact: true }).click();
    await expect(this.button('Сохранить')).toBeVisible();
  }

  stage(caption: string): Locator {
    return this._page.locator('[data-item-marker="DcmActionsDashboardContainer"]')
      .getByText(caption, { exact: true });
  }

  async expectStage(caption: string): Promise<void> {
    await expect(this.stage(caption)).toBeVisible();
    await expect(this.stage(caption).locator('xpath=ancestor::*[contains(@class,"stage-item")][1]'))
      .toHaveClass(/\bstage-current\b/);
  }

  async changeStage(caption: string): Promise<void> {
    const dashboard = this._page.locator('[data-item-marker="DcmActionsDashboardContainer"]');
    await dashboard.locator('.stage-item.stage-enabled').first().waitFor();
    if (await this.stage(caption).isVisible()) {
      const item = this.stage(caption).locator('xpath=ancestor::*[contains(@class,"stage-item")][1]');
      if ((await item.getAttribute('class'))?.includes('stage-with-menu')) {
        await item.locator('.t-btn-menuWrap').click();
        await this._page.locator('li.menu-item:visible').filter({ hasText: exactText(caption) }).click();
      } else {
        await this.stage(caption).click();
      }
      return;
    }

    // Some stages are alternatives inside a stage group's arrow menu.
    const groups = dashboard.locator('.stage-item.stage-with-menu');
    for (let index = 0; index < await groups.count(); index++) {
      await groups.nth(index).locator('.t-btn-menuWrap').click();
      const option = this._page.locator('li.menu-item:visible').filter({ hasText: exactText(caption) });
      if (await option.isVisible()) {
        await option.click();
        return;
      }
      await this._page.keyboard.press('Escape');
    }
    throw new Error(`Stage «${caption}» is not available in the case stage controls`);
  }
}
