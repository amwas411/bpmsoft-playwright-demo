import { Locator } from '@playwright/test';
import { test, expect } from './adm-document.fixture';
import { Controller } from '../controller';

// Source: adm-document.txt, test case 328984. The fixture creates the client,
// card product, and a separate complaint in «На рассмотрении» before each run.
test('administrative document: create a card instruction from a complaint', async ({ page, scenario }) => {
  test.setTimeout(5 * 60 * 1000);
  const controller = new Controller(page);
  const { data, caseId, caseNumber, clientId, productId, productName } = scenario;
  const applicant = 'Иванов Иван Иванович';
  const employee = 'Сидорова Анна Викторовна';
  let template: string;
  let operation: string;
  let documentId: string;

  const detail = (caption: string): Locator => page.locator('.detail').filter({
    has: page.getByText(caption, { exact: true }),
  });
  const documents = detail('Распорядительные документы');
  // The deployed detail caption is «Типы операции»; scope by its schema name.
  const operations = page.locator('.detail[id*="NrbOperationTypeAdminDocDetail"]');
  const addButton = (scope: Locator): Locator => scope.locator('[data-item-marker="AddRecordButton"]');

  async function selectRecord(caption: string, value: string, id: string): Promise<void> {
    await controller.selectLookupRecord(caption, value, id);
  }

  await test.step('2–4: open the prepared complaint and verify its initial state', async () => {
    // Authentication and precondition creation are handled by the fixture.
    await expect(page.getByRole('treeitem', { name: 'Обращения', exact: true })).toBeVisible();
    await controller.openSectionInWorkplace('Сотрудник', 'Обращения');
    await controller.clearSectionFilters();
    await expect(controller.record(caseNumber)).toBeVisible();
    await controller.openRecord(caseNumber);
    await controller.expectStage('На рассмотрении');
    await expect(controller.input('Заявитель')).toHaveValue('');
    await expect(page.locator('.ts-tabpanel-items:visible > li')
      .filter({ hasText: /^Обработка$/ })).toBeVisible();
  });

  await test.step('5–6: select the client and verify the ABS ID and document detail', async () => {
    await selectRecord('Заявитель', applicant, clientId);
    await expect(controller.input('АБС Id клиента')).toHaveValue('1234567890');
    await controller.openTab('Информация по обращению');
    await expect(documents).toBeVisible();
    await expect(addButton(documents)).toBeVisible();
  });

  await test.step('7: add a document and verify its defaults and required fields', async () => {
    await addButton(documents).click();
    await expect(controller.input('Тип документа')).toBeVisible();
    await expect(controller.input('Номер')).toHaveValue('');
    await expect(controller.input('Статус')).toHaveValue('Новое');
    await expect(controller.input('Тип документа')).toHaveValue('');
    await expect(controller.input('Обращение')).toHaveValue(caseNumber);
    await expect(controller.input('Клиент')).toHaveValue(applicant);
    await expect(controller.input('АБС Id клиента')).toHaveValue('1234567890');
    await expect(controller.input('Создал')).toHaveValue(employee);
    await expect(controller.input('Дата создания')).toHaveValue('');
    for (const caption of ['Тип документа', 'Обращение', 'Клиент']) {
      await controller.expectRequired(caption, true);
    }
  });

  await test.step('8–10: fill the card document and verify automatic values', async () => {
    await controller.selectDropdown('Тип документа', 'По картам (тип 1)');
    await selectRecord('Продукт', productName, productId);
    await expect(controller.input('Номер карты')).toHaveValue('0956758736509745');
    await expect(controller.input('Номер карточного счета')).toHaveValue('1673492747830175');
    // The scenario's UID is displayed as «Id карты» on this form.
    await expect(controller.input('Id карты')).toHaveValue('568391');
    await controller.openLookup('Кейс');
    const grid = page.locator('#grid-grid-wrap');
    const row = grid.locator('.grid-listed-row, .grid-row[data-item-marker]').first();
    await expect(row).toBeVisible();
    template = (await row.locator('[grid-data-type="text"], [grid-data-type="title"]').first().innerText()).trim();
    expect(template, 'An available document case template').not.toBe('');
    await row.click();
    await controller.clickButton('Выбрать', true);
    await expect(grid).toBeHidden();
    await expect(controller.input('Кейс')).toHaveValue(template);
    await expect(controller.input('Комментарий')).not.toHaveValue('');
  });

  await test.step('11–13: add an operation type through its lookup', async () => {
    await expect(operations).toBeVisible();
    await addButton(operations).click();
    // Editable detail cells have grid headers rather than form field labels.
    await operations.locator('.base-edit-right-icon-wrapper:visible').click();
    await expect(page.locator('#grid-grid-wrap')).toBeVisible();
    for (const caption of ['Выбрать', 'Поиск', 'Отмена']) {
      await expect(controller.button(caption)).toBeVisible();
    }
    const grid = page.locator('#grid-grid-wrap');
    const row = grid.locator('.grid-listed-row, .grid-row[data-item-marker]').first();
    await expect(row).toBeVisible();
    operation = (await row.locator('[grid-data-type="text"], [grid-data-type="title"]').first().innerText()).trim();
    expect(operation, 'An available operation type').not.toBe('');
    await row.click();
    await controller.clickButton('Выбрать', true);
    await expect(grid).toBeHidden();
    await expect(operations.locator('input:visible')).toHaveValue(operation);
    const [savedOperation] = await Promise.all([
      page.waitForResponse(response => response.url().includes('InsertQuery')
        && response.request().method() === 'POST'
        && response.request().postDataJSON()?.rootSchemaName === 'NrbOperationTypeAdminDoc'),
      operations.locator('[data-item-marker="save"]').click(),
    ]);
    expect(savedOperation.ok(), 'Operation type save HTTP response').toBe(true);
    const saved = await savedOperation.json();
    expect(saved.success, `Operation type save: ${JSON.stringify(saved.responseStatus ?? {})}`).toBe(true);
    await expect(operations).toContainText(operation);
  });

  await test.step('14: save the document and verify the persisted values', async () => {
    // Adding an editable detail may already have inserted its parent document.
    // Verify the final persisted state after Save, regardless of insert/update.
    const save = controller.button('Сохранить');
    await expect(save.or(controller.button('Закрыть'))).toBeVisible();
    if (await save.isVisible()) await save.click();
    await expect(controller.button('Закрыть')).toBeVisible();
    let rows: Record<string, any>[] = [];
    await expect(async () => {
      rows = await data.select('NrbAdministrativeDocument', { NrbCase: caseId }, [
        'Id', 'NrbNumber', 'NrbDocumentType', 'NrbTemplate', 'NrbStatus', 'CreatedOn', 'NrbProduct', 'NrbClient',
      ]);
      expect(rows).toHaveLength(1);
    }).toPass({ timeout: 30_000 });
    documentId = rows[0].Id;
    data.own('NrbAdministrativeDocument', documentId);
    expect(rows[0].NrbNumber).toBe('');
    expect(rows[0].NrbDocumentType.displayValue).toMatch(/^По картам \(тип 1\)$/i);
    expect(rows[0].NrbTemplate.displayValue).toBe(template);
    expect(rows[0].NrbStatus.displayValue).toBe('Новое');
    expect(rows[0].CreatedOn).toBeTruthy();
    expect(rows[0].NrbProduct.value).toBe(productId);
    expect(rows[0].NrbClient.value).toBe(clientId);
    const operationRows = await data.select('NrbOperationTypeAdminDoc', {
      NrbAdministrativeDocument: documentId,
    }, ['Id', 'NrbOperationType']);
    expect(operationRows).toHaveLength(1);
    expect(operationRows[0].NrbOperationType.displayValue).toBe(operation);
    data.own('NrbOperationTypeAdminDoc', operationRows[0].Id);
  });

  await test.step('15: close the document and verify its row on the complaint', async () => {
    await controller.clickButton('Закрыть', true);
    await expect(page.locator('[data-item-marker="CasePageContainer"]')).toBeVisible();
    await controller.openTab('Информация по обращению');
    const row = documents.locator(`[id$="${documentId}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(/По картам \(тип 1\)/i);
    await expect(row).toContainText(template);
    await expect(row).toContainText('Новое');
    await expect(row).toContainText(/\d{2}\.\d{2}\.\d{4}/);
    // Reopen from the detail to check the saved empty number and creation date
    // even when the grid's user-specific column layout omits either field.
    await row.dblclick();
    await expect(controller.input('Номер')).toHaveValue('');
    await expect(controller.input('Дата создания')).not.toHaveValue('');
    await expect(operations).toContainText(operation);
  });
});
