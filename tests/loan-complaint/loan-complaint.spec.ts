import { test, expect } from '@playwright/test';
import { Controller } from '../controller';

// Source: loan-complaint.txt. The employee, roles, queue, operator, filters, service,
// and category hierarchy from step 1 must already exist in the test system.
test('loan complaint: create a non-client, assign from queue, and validate closure', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  const controller = new Controller(page);
  const employee = 'Сидорова Анна Викторовна';
  const applicant = 'Иванов Иван Иванович';
  const queue = 'Жалобы и операционные запросы по кредитам';
  let caseNumber: string;
  let eventDate: Date;
  let closureReason: string;

  await test.step('2–3: log in as the queue operator and open Обращения', async () => {
    await controller.login(process.env.login, process.env.password);
    await controller.openSectionInWorkplace('Сотрудник', 'Обращения');
    await expect(page.getByRole('treeitem', { name: 'Обращения', exact: true })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: 'Единое окно', exact: true })).toBeVisible();
    await expect(controller.button('Добавить обращение')).toBeVisible();
    await controller.clearSectionFilters();
  });

  await test.step('4: open a new complaint and verify its profile, stage, and required fields', async () => {
    await controller.clickButton('Добавить обращение', true);
    await expect(controller.button('Сохранить')).toBeVisible();
    const heading = page.getByText(/^Обращение №\S+$/);
    await expect(heading).toBeVisible();
    caseNumber = (await heading.innerText()).replace(/^Обращение №/, '').trim();
    expect(caseNumber).not.toBe('');
    for (const caption of ['Срок ответа', 'Заявитель', 'АБС Id клиента', 'Категория',
      'Уровень 1', 'Уровень 2', 'Уровень 3', 'Уровень 4', 'Сервис', 'Ответственный']) {
      // Срок ответа also exists on the information tab; check the profile explicitly.
      await expect(controller.label(caption).first()).toBeVisible();
    }
    await expect(controller.button('Назначить меня')).toBeVisible();
    await controller.expectStage('Заведено');
    await controller.openTab('Информация по обращению');
    for (const caption of ['Описание', 'Канал ответа', 'Тип продукта']) {
      await controller.expectRequired(caption, true);
    }
  });

  await test.step('5: fill the loan complaint and verify automatic service and deadline', async () => {
    await controller.selectDropdown('Категория', 'Жалоба');
    await controller.selectLookup('Уровень 1', 'Жалобы по кредитам / Complaints by loans');
    await controller.selectLookup('Уровень 2', 'Несогласие с задолженностью по кредиту / Disagreement with loan debt');
    await controller.selectLookup('Уровень 3', 'Другое / Other');
    await controller.fill('Описание', 'Жалоба про кредиту');
    await controller.selectDropdown('Канал ответа', 'SMS');
    await controller.selectLookup('Тип продукта', 'Карта Card Plus/ Card Plus');
    await expect(controller.input('Сервис')).toHaveValue('Жалоба (3 раб. дня, 10 раб. дней)');
    await expect(page.locator('#CasePageSolutionDateProfileDateEdit-el')).not.toHaveValue('');
    await expect(page.locator('#CasePageSolutionDateProfileTimeEdit-el')).not.toHaveValue('');
  });

  await test.step('6–7: fill optional complaint justification and current event date', async () => {
    await controller.openTab('Решение и закрытие');
    await controller.expectRequired('Обоснованность жалобы', false);
    await controller.expectRequired('Дата события', false);
    await controller.selectLookup('Обоснованность жалобы', 'К сведению');
    eventDate = new Date();
    await controller.fillEventDate(eventDate);
    await expect(controller.button('Сохранить')).toBeVisible();
  });

  await test.step('8–10: create a Не клиент contact from the applicant lookup', async () => {
    await controller.openLookup('Заявитель');
    await expect(page.getByText(/^Выбор:\s*Контакт$/)).toBeVisible();
    for (const caption of ['Поиск', 'Выбрать', 'Отмена', 'Добавить']) {
      await expect(controller.button(caption)).toBeVisible();
    }
    await controller.clickButton('Добавить', true);
    await page.getByText('Не клиент', { exact: true }).click();
    await expect(controller.input('Тип')).toHaveValue('Не клиент');
    for (const caption of ['ФИО', 'Мобильный телефон', 'Email', 'Дата рождения']) {
      await expect(controller.input(caption)).toHaveValue('');
    }
  });

  await test.step('11–12: save the new contact and verify the applicant on the complaint', async () => {
    await controller.fill('ФИО', applicant);
    await controller.fillPhone('89999999999');
    await controller.fill('Email', 'test_test11@mail.ru');
    await controller.fill('Дата рождения', '10.10.1990');
    await controller.save('InsertQuery', true);
    await expect(controller.input('Заявитель')).toHaveValue(applicant);
    await expect(controller.input('АБС Id клиента')).toHaveValue('');
    await expect(controller.button('Назначить меня')).toBeVisible();
  });

  await test.step('13: save and close the complaint', async () => {
    await controller.save('InsertQuery');
    await expect(page.locator('[data-item-marker="CasePageContainer"]')).toBeHidden();
  });

  await test.step('14: wait 120 seconds, then locate the complaint in the queue', async () => {
    // Step 14 explicitly allows the background queue-filling job 120 seconds
    // before opening the section, which loads its queue items on entry.
    await page.waitForTimeout(120 * 1000);
    await controller.openSectionInWorkplace('Сотрудник', 'Единое окно');
    await controller.openTab('Обращения');
    // This UI groups queue items under the entity tab rather than rendering
    // queue names as selectable controls.
    await controller.waitForQueueRecord(caseNumber, queue);
    await expect(controller.record(caseNumber)).toContainText(eventDate.toLocaleDateString('ru-RU'));
  });

  await test.step('15–17: assign the queue item to the operator and verify it leaves the queue', async () => {
    await controller.openQueueRecord(caseNumber);
    await expect(controller.input('Заявитель')).toHaveValue(applicant);
    await controller.clickButton('Назначить меня', true);
    await expect(controller.input('Ответственный')).toHaveValue(employee);
    await controller.save('UpdateQuery');
    await expect(page).toHaveTitle('Единое окно');
    await expect(controller.record(caseNumber)).toHaveCount(0);
  });

  await test.step('18–20: reopen the complaint and move from Заведено to На рассмотрении', async () => {
    await controller.openSectionInWorkplace('Сотрудник', 'Обращения');
    await controller.clearSectionFilters();
    await expect(controller.record(caseNumber)).toBeVisible();
    await controller.openRecord(caseNumber);
    await controller.expectStage('Заведено');
    await controller.changeStage('На рассмотрении');
    await controller.expectStage('На рассмотрении');
  });

  await test.step('21–22: cancel Возвращено на исправление and preserve the current stage', async () => {
    await controller.changeStage('Возвращено на исправление');
    await expect(controller.input('Кому')).toBeVisible();
    await expect(controller.input('Комментарий')).toBeVisible();
    await controller.clickButton('Отмена', true);
    await expect(controller.label('Комментарий')).toHaveCount(0);
    await controller.expectStage('На рассмотрении');
  });

  await test.step('23–24: move through Согласование and Рассмотрение подразделением', async () => {
    await controller.changeStage('Согласование');
    await controller.expectStage('Согласование');
    await controller.changeStage('Рассмотрение подразделением');
    await controller.expectStage('Рассмотрение подразделением');
  });

  await test.step('25–28: attempt closure without a solution and verify the validation error', async () => {
    await controller.changeStage('Закрыто');
    await expect(page.getByText('Укажите причину закрытия обращения', { exact: true })).toBeVisible();
    // The specification permits any available reason; retain it for the solution-tab check.
    await controller.control('Причина закрытия').locator('.base-edit-right-icon-wrapper').click();
    const option = page.locator('li[data-value]:visible:not([data-value=""])').first();
    await expect(option).toBeVisible();
    closureReason = (await option.innerText()).trim();
    expect(closureReason).not.toBe('');
    await option.click();
    await expect(controller.input('Причина закрытия')).toHaveValue(closureReason);
    await controller.clickButton('Ок', true);
    await expect(page.getByText('Укажите причину закрытия обращения', { exact: true })).toBeHidden();
    const error = page.getByText(/Поле [«"“]?Решение[»"”]?: Необходимо указать значение\.?/);
    await expect(error).toBeVisible();
    await controller.clickButton('ОК', true);
    await expect(error).toBeHidden();
  });

  await test.step('29–31: provide a solution, save, and verify closure and required fields', async () => {
    await controller.openTab('Решение и закрытие');
    await expect(controller.input('Причина закрытия')).toHaveValue(closureReason);
    await controller.fill('Решение', 'Обращение рассмотрено, заявителю направлен ответ.');
    const recordUrl = page.url();
    await controller.save('UpdateQuery');
    // Read the saved record again even if the register hides closed complaints.
    await page.goto(recordUrl);
    await controller.expectStage('Закрыто');
    await controller.openTab('Решение и закрытие');
    await controller.expectRequired('Дата события', true);
    await controller.expectRequired('Обоснованность жалобы', true);
    await expect(controller.input('Решение')).toHaveValue('Обращение рассмотрено, заявителю направлен ответ.');
    await expect(controller.input('Обоснованность жалобы')).toHaveValue('К сведению');
    await expect(controller.input('Дата события')).toHaveValue(eventDate.toLocaleDateString('ru-RU'));
  });
});
