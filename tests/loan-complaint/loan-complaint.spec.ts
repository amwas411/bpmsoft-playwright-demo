import { test, expect } from '@playwright/test';
import { Controller } from '../controller';
import { ComplaintWorkflow } from './complaint-workflow';

// Source: loan-complaint.txt. The employee, roles, queue, operator, filters, service,
// and category hierarchy from step 1 must already exist in the test system.
test('loan complaint: create a non-client, assign from queue, and validate closure', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  const controller = new Controller(page);
  const workflow = new ComplaintWorkflow(page);
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
    await expect(workflow.button('Добавить обращение')).toBeVisible();
  });

  await test.step('4: open a new complaint and verify its profile, stage, and required fields', async () => {
    await workflow.clickButton('Добавить обращение');
    await expect(workflow.button('Сохранить')).toBeVisible();
    const heading = page.getByText(/^Обращение №\S+$/);
    await expect(heading).toBeVisible();
    caseNumber = (await heading.innerText()).replace(/^Обращение №/, '').trim();
    expect(caseNumber).not.toBe('');
    for (const caption of ['Срок ответа', 'Заявитель', 'АБС Id клиента', 'Категория',
      'Уровень 1', 'Уровень 2', 'Уровень 3', 'Уровень 4', 'Сервис', 'Ответственный']) {
      // Срок ответа also exists on the information tab; check the profile explicitly.
      await expect(workflow.label(caption).first()).toBeVisible();
    }
    await expect(workflow.button('Назначить меня')).toBeVisible();
    await workflow.expectStage('Заведено');
    await workflow.openTab('Информация по обращению');
    for (const caption of ['Описание', 'Канал ответа', 'Тип продукта']) {
      await workflow.expectRequired(caption, true);
    }
  });

  await test.step('5: fill the loan complaint and verify automatic service and deadline', async () => {
    await workflow.selectDropdown('Категория', 'Жалоба');
    await workflow.selectLookup('Уровень 1', 'Жалобы по кредитам / Complaints by loans');
    await workflow.selectLookup('Уровень 2', 'Несогласие с задолженностью по кредиту / Disagreement with loan debt');
    await workflow.selectLookup('Уровень 3', 'Другое / Other');
    await workflow.fill('Описание', 'Жалоба про кредиту');
    await workflow.selectDropdown('Канал ответа', 'SMS');
    await workflow.selectLookup('Тип продукта', 'Карта Card Plus/ Card Plus');
    await expect(workflow.input('Сервис')).toHaveValue('Жалоба (3 раб. дня, 10 раб. дней)');
    await expect(page.locator('#CasePageSolutionDateProfileDateEdit-el')).not.toHaveValue('');
    await expect(page.locator('#CasePageSolutionDateProfileTimeEdit-el')).not.toHaveValue('');
  });

  await test.step('6–7: fill optional complaint justification and current event date', async () => {
    await workflow.openTab('Решение и закрытие');
    await workflow.expectRequired('Обоснованность жалобы', false);
    await workflow.expectRequired('Дата события', false);
    await workflow.selectLookup('Обоснованность жалобы', 'К сведению');
    eventDate = new Date();
    await workflow.fillEventDate(eventDate);
    await expect(workflow.button('Сохранить')).toBeVisible();
  });

  await test.step('8–10: create a Не клиент contact from the applicant lookup', async () => {
    await workflow.openLookup('Заявитель');
    await expect(page.getByText(/^Выбор:\s*Контакт$/)).toBeVisible();
    for (const caption of ['Поиск', 'Выбрать', 'Отмена', 'Добавить']) {
      await expect(workflow.button(caption)).toBeVisible();
    }
    await workflow.clickButton('Добавить');
    await page.getByText('Не клиент', { exact: true }).click();
    await expect(workflow.input('Тип')).toHaveValue('Не клиент');
    for (const caption of ['ФИО', 'Мобильный телефон', 'Email', 'Дата рождения']) {
      await expect(workflow.input(caption)).toHaveValue('');
    }
  });

  await test.step('11–12: save the new contact and verify the applicant on the complaint', async () => {
    await workflow.fill('ФИО', applicant);
    await workflow.fillPhone('89999999999');
    await workflow.fill('Email', 'test_test11@mail.ru');
    await workflow.fill('Дата рождения', '10.10.1990');
    await workflow.save('InsertQuery', true);
    await expect(workflow.input('Заявитель')).toHaveValue(applicant);
    await expect(workflow.input('АБС Id клиента')).toHaveValue('');
    await expect(workflow.button('Назначить меня')).toBeVisible();
  });

  await test.step('13: save and close the complaint', async () => {
    await workflow.save('InsertQuery');
    await expect(page.locator('[data-item-marker="CasePageContainer"]')).toBeHidden();
  });

  await test.step('14: wait 120 seconds, then locate the complaint in the queue', async () => {
    // Step 14 explicitly allows the background queue-filling job 120 seconds
    // before opening the section, which loads its queue items on entry.
    await page.waitForTimeout(120 * 1000);
    await controller.openSectionInWorkplace('Сотрудник', 'Единое окно');
    await workflow.openTab('Обращения');
    // This UI groups queue items under the entity tab rather than rendering
    // queue names as selectable controls.
    await workflow.waitForQueueRecord(caseNumber, queue);
    await expect(workflow.record(caseNumber)).toContainText(eventDate.toLocaleDateString('ru-RU'));
  });

  await test.step('15–17: assign the queue item to the operator and verify it leaves the queue', async () => {
    await workflow.openQueueRecord(caseNumber);
    await expect(workflow.input('Заявитель')).toHaveValue(applicant);
    await workflow.clickButton('Назначить меня');
    await expect(workflow.input('Ответственный')).toHaveValue(employee);
    await workflow.save('UpdateQuery');
    await expect(page).toHaveTitle('Единое окно');
    await expect(workflow.record(caseNumber)).toHaveCount(0);
  });

  await test.step('18–20: reopen the complaint and move from Заведено to На рассмотрении', async () => {
    await controller.openSectionInWorkplace('Сотрудник', 'Обращения');
    await expect(workflow.record(caseNumber)).toBeVisible();
    await workflow.openRecord(caseNumber);
    await workflow.expectStage('Заведено');
    await workflow.changeStage('На рассмотрении');
    await workflow.expectStage('На рассмотрении');
  });

  await test.step('21–22: cancel Возвращено на исправление and preserve the current stage', async () => {
    await workflow.changeStage('Возвращено на исправление');
    await expect(workflow.input('Кому')).toBeVisible();
    await expect(workflow.input('Комментарий')).toBeVisible();
    await workflow.clickButton('Отмена');
    await expect(workflow.label('Комментарий')).toHaveCount(0);
    await workflow.expectStage('На рассмотрении');
  });

  await test.step('23–24: move through Согласование and Рассмотрение подразделением', async () => {
    await workflow.changeStage('Согласование');
    await workflow.expectStage('Согласование');
    await workflow.changeStage('Рассмотрение подразделением');
    await workflow.expectStage('Рассмотрение подразделением');
  });

  await test.step('25–28: attempt closure without a solution and verify the validation error', async () => {
    await workflow.changeStage('Закрыто');
    await expect(page.getByText('Укажите причину закрытия обращения', { exact: true })).toBeVisible();
    // The specification permits any available reason; retain it for the solution-tab check.
    await workflow.control('Причина закрытия').locator('.base-edit-right-icon-wrapper').click();
    const option = page.locator('li[data-value]:visible:not([data-value=""])').first();
    await expect(option).toBeVisible();
    closureReason = (await option.innerText()).trim();
    expect(closureReason).not.toBe('');
    await option.click();
    await expect(workflow.input('Причина закрытия')).toHaveValue(closureReason);
    await workflow.clickButton('Ок');
    await expect(page.getByText('Укажите причину закрытия обращения', { exact: true })).toBeHidden();
    const error = page.getByText(/Поле [«"“]?Решение[»"”]?: Необходимо указать значение\.?/);
    await expect(error).toBeVisible();
    await workflow.clickButton('ОК');
    await expect(error).toBeHidden();
  });

  await test.step('29–31: provide a solution, save, and verify closure and required fields', async () => {
    await workflow.openTab('Решение и закрытие');
    await expect(workflow.input('Причина закрытия')).toHaveValue(closureReason);
    await workflow.fill('Решение', 'Обращение рассмотрено, заявителю направлен ответ.');
    const recordUrl = page.url();
    await workflow.save('UpdateQuery');
    // Read the saved record again even if the register hides closed complaints.
    await page.goto(recordUrl);
    await workflow.expectStage('Закрыто');
    await workflow.openTab('Решение и закрытие');
    await workflow.expectRequired('Дата события', true);
    await workflow.expectRequired('Обоснованность жалобы', true);
    await expect(workflow.input('Решение')).toHaveValue('Обращение рассмотрено, заявителю направлен ответ.');
    await expect(workflow.input('Обоснованность жалобы')).toHaveValue('К сведению');
    await expect(workflow.input('Дата события')).toHaveValue(eventDate.toLocaleDateString('ru-RU'));
  });
});
