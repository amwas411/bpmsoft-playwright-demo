import { expect, Page } from '@playwright/test';
import assert from "assert";

export async function login(page: Page, login: string | undefined, password: string | undefined) {
  assert(process.env.baseURL);
  assert(login);
  assert(password);

  await page.goto(process.env.baseURL);
  await page.fill("#loginEdit-el", login);
  await page.fill("#passwordEdit-el", password);
  await page.click("[data-item-marker='btnLogin']");
}

export async function openSectionInWorkplace(page: Page, workplaceCaption: string | undefined, sectionCaption: string | undefined) {
  assert(workplaceCaption);
  assert(sectionCaption);

  await page
    .getByRole('region', { name: workplaceCaption })
    .getByRole('treeitem', { name: sectionCaption })
    .click();
  
  await expect(page).toHaveURL(/ViewModule\.aspx/);
}