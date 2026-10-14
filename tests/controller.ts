import { expect, Page, Locator } from '@playwright/test';
import assert from "assert";

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

    const workplaceButton = this._page.getByRole('button', { name: workplaceCaption });
    if (await workplaceButton.getAttribute('aria-expanded') === 'false') {
      await workplaceButton.click();
    }

    await this._page.getByRole('region', { name: workplaceCaption })
      .getByRole('treeitem', { name: sectionCaption })
      .click();

    await expect(this._page).toHaveURL(/ViewModule\.aspx/);
  }

  async clickButton(buttonCaption: string | undefined) {
    assert(buttonCaption);

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

    await this.getColumnInput(columnCaption).fill(columnValue);

    if (isLookup) {
      await this.openColumnLookup(this.getColumn(columnCaption));
      const lookupGrid = this._page.locator('#grid-grid-wrap');
      await lookupGrid.locator(`[data-item-marker=${JSON.stringify(columnValue)}]`).click();
      await this.clickButton("Выбрать");
      await expect(lookupGrid).toBeHidden();
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
}
