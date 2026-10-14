import { test, expect } from '@playwright/test';
import { Controller } from './controller';

[
  { workplace: "Продажи", section: "Итоги" },
  { workplace: "Сервис", section: "Контакты" },
].forEach(({ workplace, section }) =>

  test(`section ${section} in the ${workplace} workplace opens`, async ({ page }) => {
    let controller = new Controller(page);
    await controller.login(process.env.login, process.env.password);
    await controller.openSectionInWorkplace(workplace, section);
    await expect(page).toHaveTitle(`${section}`);
  })

);

[
  { workplace: "Сервис", section: "Обращения" },
].forEach(({ workplace, section }) =>

  test("fill up a case", async ({ page }) => {
    let controller = new Controller(page);
    await controller.login(process.env.login, process.env.password);
    await controller.openSectionInWorkplace(workplace, section);

    // Click "Добавить обращение" / "Добавить" in the section toolbar.
    await controller.clickButton("Добавить");

    // Fill the "Тема" field.
    const subject = `Автотест обращение ${Date.now()}`;
    const contact = "uitestadmin";
    await controller.setColumnValue("Тема", subject, false);
    await controller.setColumnValue("Контакт", contact, true);

    await controller.clickButton("Сохранить");
    let response = await page.waitForResponse(/InsertQuery/);
    expect(response.ok());

    await expect(controller.getColumnInput("Тема")).toHaveValue(subject);
    await expect(controller.getColumnInput("Контакт")).toHaveValue(contact);
  })

);
