import { test, expect } from '@playwright/test';
import assert from 'assert';
import * as controller from './controller';

test('has title', async ({ page }) => {
  assert(process.env.baseURL);
  await page.goto(process.env.baseURL);
  
  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Login/);
});

test('login works', async ({ page }) => {
  await controller.login(page, process.env.login, process.env.password);
  // Expects page to have a heading with the name of Installation.
  await expect(page).toHaveTitle(/BPMSoft/);
});

[
  {workplace: "Продажи", section: "Итоги"},
  {workplace: "Сервис", section: "Контакты"},
].forEach(({workplace, section}) => 

  test(`section ${section} in the ${workplace} workplace opens`, async ({ page }) => {
    await controller.login(page, process.env.login, process.env.password);
    await controller.openSectionInWorkplace(page, workplace, section);
    await expect(page).toHaveTitle(`${section}`);
  })

);

[
  {workplace: "Сервис", section: "Обращения"},
].forEach(({workplace, section}) => 

  test("fill up a case", async ({page}) => {
    await controller.login(page, process.env.login, process.env.password);
    await controller.openSectionInWorkplace(page, workplace, section);

    // Click "Добавить обращение" / "Добавить" in the section toolbar.
      page
        .getByRole('button', { name: /^(Добавить обращение|Добавить)$/ })
        .click();

      // Wait for the edit page of the new record.
      await expect(page).toHaveURL(/CardModule|EditPage|Nui\/ViewModule\.aspx/i);

      // Fill the "Тема" field.
      const subject = `Автотест обращение ${Date.now()}`;
      const subjectField = page
        .getByLabel('Тема', { exact: false })
        .or(page.locator('[data-item-marker="SubjectEdit-el"]'));

      await subjectField.fill(subject);
      
      page
        .getByRole('button', { name: "Сохранить" })
        .click();

      await expect(subjectField).toHaveValue(subject);
  })

);
