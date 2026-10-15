import { test, expect } from '@playwright/test';
import { Controller } from '../controller';

[
  { workplace: "Сотрудник", section: "Контакты" },
].forEach(({ workplace, section }) =>

  test(`section ${section} in the ${workplace} workplace opens`, async ({ page }) => {
    let controller = new Controller(page);
    await controller.login(process.env.login, process.env.password);
    await controller.openSectionInWorkplace(workplace, section);
    await expect(page).toHaveTitle(`${section}`);
  })

);

[
  { workplace: "Сотрудник", section: "Обращения" },
].forEach(({ workplace, section }) =>

  test("fill up a case", async ({ page }) => {
    let controller = new Controller(page);
    await controller.login(process.env.login, process.env.password);
    await controller.openSectionInWorkplace(workplace, section);

    await controller.clickButton("Добавить обращение", true);
    const heading = page.getByText(/^Обращение №\S+$/);
    await expect(heading).toBeVisible();
    const caseNumber = (await heading.innerText()).replace(/^Обращение №/, '').trim();

    const contact = "uitestadmin";
    const level = "Доп. офисы /  Branches";
    const description = "Описание";
    const channel = "SMS";
    const type = "Автокредит/ Car loan";
    await controller.selectDropdown("Категория", "Благодарность");
    await controller.selectLookup("Заявитель", contact);
    await controller.setColumnValue("Уровень 1", level, true);
    await controller.openTab("Информация по обращению");
    await controller.fill("Описание", description);
    await controller.selectDropdown("Канал ответа", channel);
    await controller.selectLookup("Тип продукта", type);

    await controller.save('InsertQuery');
    await expect(page.locator('[data-item-marker="CasePageContainer"]')).toBeHidden();
    await controller.clearSectionFilters();
    await controller.openRecord(caseNumber);
    await controller.openTab("Информация по обращению");

    await expect(controller.input("Заявитель")).toHaveValue(contact);
    // The stored name has two spaces; the lookup UI collapses them on display.
    await expect.poll(async () => (await controller.input("Уровень 1").inputValue())
      .replace(/\s+/g, ' ')).toBe(level.replace(/\s+/g, ' '));
    await expect(controller.input("Описание")).toHaveValue(description);
    await expect(controller.input("Канал ответа")).toHaveValue(channel);
    await expect(controller.input("Тип продукта")).toHaveValue(type);
  })

);
