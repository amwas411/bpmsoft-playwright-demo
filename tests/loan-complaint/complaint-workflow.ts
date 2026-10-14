import { expect, Locator, Page } from '@playwright/test';

function exactText(text: string): RegExp {
  return new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
}

/** Controls used by the complaint workflow specified in loan-complaint.txt. */
export class ComplaintWorkflow {
  constructor(private readonly page: Page) {}

  label(caption: string): Locator {
    return this.page.locator('.label-wrap:visible label').filter({ hasText: exactText(caption) });
  }

  control(caption: string): Locator {
    const labelWrap = this.page.locator('.label-wrap:visible').filter({
      has: this.page.locator('label').filter({ hasText: exactText(caption) }),
    });
    return labelWrap.locator('xpath=following-sibling::div[contains(@class,"control-wrap")][1]');
  }

  input(caption: string): Locator {
    return this.control(caption).locator('input:not([type="checkbox"]), textarea:not(.virtual)').first();
  }

  button(caption: string): Locator {
    const modal = this.page.locator('.ts-modalbox:visible');
    const scope = modal.last().or(this.page.locator('body').filter({ hasNot: modal }));
    if (caption === 'Поиск') {
      return scope.locator('.t-btn-wrapper[data-tag="SearchButton"]:visible');
    }
    return scope.locator('.t-btn-wrapper:visible')
      .filter({ hasText: new RegExp(exactText(caption).source, 'i') });
  }

  async clickButton(caption: string): Promise<void> {
    await this.button(caption).click();
  }

  async openSection(caption: string): Promise<void> {
    await this.page.getByRole('treeitem', { name: caption, exact: true }).click();
    await expect(this.page).toHaveTitle(caption);
  }

  async openTab(caption: string): Promise<void> {
    await this.page.locator('.ts-tabpanel-items:visible > li')
      .filter({ hasText: exactText(caption) }).click();
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
    await this.page.locator('li[data-value]:visible').filter({ hasText: exactText(value) }).click();
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
    await expect(this.page.locator('#grid-grid-wrap')).toBeVisible();
  }

  async selectLookup(caption: string, value: string): Promise<void> {
    await this.openLookup(caption);
    const grid = this.page.locator('#grid-grid-wrap');
    await grid.getByText(value, { exact: true }).click();
    await this.clickButton('Выбрать');
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
    const responsePromise = this.page.waitForResponse(response =>
      response.url().includes(query) && response.request().method() === 'POST');
    const [response] = await Promise.all([
      responsePromise,
      (async () => {
        await this.clickButton('Сохранить');
        if (confirmDuplicateContact) {
          // Repeated runs use the specification's fixed contact details.
          // The duplicate review can require a second Save before insertion.
          const duplicateReview = this.page.getByText("Поиск дублей в разделе 'Контакты'", { exact: true });
          const needsConfirmation = await Promise.race([
            responsePromise.then(() => false),
            duplicateReview.waitFor({ state: 'visible' }).then(() => true),
          ]);
          if (needsConfirmation) await this.clickButton('Сохранить');
        }
      })(),
    ]);
    expect(response.ok(), `${query} HTTP response`).toBe(true);
    const result = await response.json();
    expect(result.success, `${query} application response`).toBe(true);
  }

  record(number: string): Locator {
    return this.page.locator('.grid-listed-row, .grid-row[data-item-marker]').filter({
      has: this.page.getByText(number, { exact: true }),
    });
  }

  async waitForQueueRecord(number: string, queue: string): Promise<void> {
    let firstAttempt = true;
    await expect(async () => {
      // Queue contents are loaded on entry. If the background job finishes
      // after that request, refresh to fetch the new item on the next attempt.
      if (!firstAttempt) {
        await this.page.reload();
        await this.openTab('Обращения');
      }
      firstAttempt = false;
      await expect(this.record(number), `Complaint ${number} should appear in queue «${queue}»`)
        .toBeVisible({ timeout: 3000 });
      await expect(this.record(number)).toHaveAttribute('data-item-marker', queue);
    }).toPass({ timeout: 60 * 1000, intervals: [5000, 10000] });
  }

  async openRecord(number: string): Promise<void> {
    await this.record(number).getByText(number, { exact: true }).click();
    await expect(this.page).toHaveTitle(new RegExp(`^Обращение №${number}(?:\\s|:|$)`));
    await expect(this.page.locator('[data-item-marker="CasePageContainer"]')).toBeVisible();
  }

  async openQueueRecord(number: string): Promise<void> {
    await this.record(number).locator('button.grid-row-actions-button').click();
    await this.page.getByText('Открыть', { exact: true }).click();
    await expect(this.button('Сохранить')).toBeVisible();
  }

  stage(caption: string): Locator {
    return this.page.locator('[data-item-marker="DcmActionsDashboardContainer"]')
      .getByText(caption, { exact: true });
  }

  async expectStage(caption: string): Promise<void> {
    await expect(this.stage(caption)).toBeVisible();
    await expect(this.stage(caption).locator('xpath=ancestor::*[contains(@class,"stage-item")][1]'))
      .toHaveClass(/\bstage-current\b/);
  }

  async changeStage(caption: string): Promise<void> {
    const dashboard = this.page.locator('[data-item-marker="DcmActionsDashboardContainer"]');
    await dashboard.locator('.stage-item.stage-enabled').first().waitFor();
    if (await this.stage(caption).isVisible()) {
      const item = this.stage(caption).locator('xpath=ancestor::*[contains(@class,"stage-item")][1]');
      if ((await item.getAttribute('class'))?.includes('stage-with-menu')) {
        await item.locator('.t-btn-menuWrap').click();
        await this.page.locator('li.menu-item:visible').filter({ hasText: exactText(caption) }).click();
      } else {
        await this.stage(caption).click();
      }
      return;
    }

    // Some stages are alternatives inside a stage group's arrow menu.
    const groups = dashboard.locator('.stage-item.stage-with-menu');
    for (let index = 0; index < await groups.count(); index++) {
      await groups.nth(index).locator('.t-btn-menuWrap').click();
      const option = this.page.locator('li.menu-item:visible').filter({ hasText: exactText(caption) });
      if (await option.isVisible()) {
        await option.click();
        return;
      }
      await this.page.keyboard.press('Escape');
    }
    throw new Error(`Stage «${caption}» is not available in the case stage controls`);
  }
}
