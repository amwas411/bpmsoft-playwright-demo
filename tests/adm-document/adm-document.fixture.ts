import { randomUUID } from 'node:crypto';
import { test as base, expect, Page } from '@playwright/test';
import { Controller } from '../controller';

type Row = Record<string, any>;
type Parameter = { dataValueType: number; value: string | null };
const text = (value: string): Parameter => ({ dataValueType: 1, value });
const guid = (value: string): Parameter => ({ dataValueType: 0, value });

function filters(values: Record<string, string>) {
  return {
    filterType: 6, logicalOperation: 0, isEnabled: true,
    items: Object.fromEntries(Object.entries(values).map(([columnPath, value]) => [columnPath, {
      filterType: 1, comparisonType: 3, isEnabled: true,
      leftExpression: { expressionType: 0, columnPath },
      rightExpression: { expressionType: 2, parameter: /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value) ? guid(value) : text(value) },
    }])),
  };
}

// Use the authenticated UI's DataService endpoint and CSRF cookie for setup only.
// The scenario itself creates the administrative document through the UI.
export class ScenarioData {
  private owned: { schema: string; id: string }[] = [];

  constructor(private page: Page, private endpoint: string) {}

  async query(operation: string, body: Row): Promise<Row> {
    const cookies = await this.page.context().cookies(this.endpoint);
    const csrf = cookies.find(cookie => cookie.name === 'BPMCSRF');
    expect(csrf, 'BPMSoft CSRF cookie after login').toBeTruthy();
    const response = await this.page.request.post(this.endpoint.replace(/SelectQuery$/, operation), {
      headers: { BPMCSRF: csrf!.value }, data: body,
    });
    expect(response.ok(), `${operation}: ${body.rootSchemaName} HTTP ${response.status()}: ${response.ok() ? '' : await response.text()}`).toBe(true);
    const result = await response.json();
    expect(result.success, `${operation}: ${body.rootSchemaName}: ${JSON.stringify(result.responseStatus ?? result.errorInfo ?? result)}`).toBe(true);
    return result;
  }

  async select(schema: string, values: Record<string, string>, columns: string[]): Promise<Row[]> {
    const result = await this.query('SelectQuery', {
      rootSchemaName: schema, operationType: 0, useLocalization: true,
      columns: { items: Object.fromEntries(columns.map(columnPath => [columnPath, {
        expression: { expressionType: 0, columnPath },
      }])) },
      filters: filters(values), rowCount: 100,
    });
    expect(result.notFoundColumns ?? [], `${schema}: requested columns exist`).toEqual([]);
    return result.rows;
  }

  async lookup(schema: string, name: string): Promise<string> {
    const rows = await this.select(schema, { Name: name }, ['Id', 'Name']);
    expect(rows, `Precondition: ${schema} «${name}» exists and is unique`).toHaveLength(1);
    return rows[0].Id;
  }

  async insert(schema: string, values: Record<string, Parameter>): Promise<string> {
    const id = randomUUID();
    await this.query('InsertQuery', {
      rootSchemaName: schema, operationType: 1,
      columnValues: { items: Object.fromEntries(Object.entries({ ...values, Id: guid(id) })
        .map(([column, parameter]) => [column, { expressionType: 2, parameter }])) },
    });
    this.owned.unshift({ schema, id });
    return id;
  }

  async update(schema: string, id: string, values: Record<string, Parameter>): Promise<void> {
    await this.query('UpdateQuery', {
      rootSchemaName: schema, operationType: 2, filters: filters({ Id: id }),
      columnValues: { items: Object.fromEntries(Object.entries(values)
        .map(([column, parameter]) => [column, { expressionType: 2, parameter }])) },
    });
  }

  async attachCreatedRecords(): Promise<void> {
    // The operator account cannot delete contacts. Keep the fixture records and
    // attach their IDs for inspection/cleanup by an account with those rights.
    await base.info().attach('created-records', {
      body: JSON.stringify(this.owned, null, 2), contentType: 'application/json',
    });
  }

  own(schema: string, id: string): void {
    this.owned.unshift({ schema, id });
  }
}

type Scenario = {
  data: ScenarioData;
  caseId: string;
  caseNumber: string;
  clientId: string;
  productId: string;
  productName: string;
};

export const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ page }, use) => {
    const controller = new Controller(page);
    const endpointPromise = page.waitForRequest(request =>
      request.url().endsWith('/SelectQuery') && request.method() === 'POST');
    await controller.login(process.env.login, process.env.password);
    await expect(page.getByRole('button', { name: 'Сотрудник', exact: true })).toBeVisible();
    const data = new ScenarioData(page, (await endpointPromise).url());
    try {
      // Reuse the scenario's client and populate its products through the UI.
      const clientType = await data.lookup('ContactType', 'Клиент');
      const clients = await data.select('Contact', {
        Name: 'Иванов Иван Иванович', Type: clientType, NrbAbsId: '1234567890',
      }, ['Id']);
      const clientId = clients[0]?.Id ?? await data.insert('Contact', {
        Name: text('Иванов Иван Иванович'), Type: guid(clientType), NrbAbsId: text('1234567890'),
      });
      const productType = await data.lookup('NrbProductType', 'Дебетовая карта');
      // Opening Products triggers the application's client-product integration.
      await page.goto(`${page.url().split('#')[0]}#CardModuleV2/NrbClientContactPage/edit/${clientId}`);
      await controller.openTab('Продукты');
      const refreshed = page.getByText('Данные по продуктам клиента обновлены успешно.', { exact: true });
      await expect(refreshed).toBeVisible();
      await controller.clickButton('ОК', true);
      await expect(refreshed).toBeHidden();
      let productId: string = '';
      let productName: string = '';
      await expect(async () => {
        const products = await data.select('NrbContactProduct', {
          NrbClient: clientId, NrbType: productType,
          NrbProductNumber: '0956758736509745', NrbAccountNumber: '1673492747830175', NrbUidCard: '568391',
        }, ['Id', 'NrbName']);
        expect(products, 'The Products tab populates the prerequisite card product').not.toHaveLength(0);
        productId = products[0].Id;
        productName = products[0].NrbName;
      }).toPass({ timeout: 60_000, intervals: [1000, 2000, 5000] });
      await controller.openSectionInWorkplace('Сотрудник', 'Обращения');
      await controller.clickButton('Добавить обращение', true);
      const heading = page.getByText(/^Обращение №\S+$/);
      await expect(heading).toBeVisible();
      const caseNumber = (await heading.innerText()).replace(/^Обращение №/, '').trim();
      await controller.selectDropdown('Категория', 'Жалоба');
      await controller.selectLookup('Уровень 1', 'Жалобы по кредитам / Complaints by loans');
      await controller.selectLookup('Уровень 2', 'Несогласие с задолженностью по кредиту / Disagreement with loan debt');
      await controller.selectLookup('Уровень 3', 'Другое / Other');
      await controller.openTab('Информация по обращению');
      await controller.fill('Описание', 'Автотест 328984: распорядительный документ');
      await controller.selectDropdown('Канал ответа', 'SMS');
      await controller.selectLookup('Тип продукта', 'Карта Card Plus/ Card Plus');
      await controller.input('Заявитель').fill('Иванов Иван Иванович');
      await controller.openLookup('Заявитель');
      await page.locator('#grid-grid-wrap').locator(`[id$="${clientId}"]`).click();
      await controller.clickButton('Выбрать', true);
      await expect(page.locator('#grid-grid-wrap')).toBeHidden();
      await controller.save('InsertQuery');
      await expect(page.locator('[data-item-marker="CasePageContainer"]')).toBeHidden();
      let cases: Row[] = [];
      await expect(async () => {
        cases = await data.select('Case', { Number: caseNumber }, ['Id']);
        expect(cases, `Saved complaint ${caseNumber}`).toHaveLength(1);
      }).toPass({ timeout: 30_000, intervals: [500, 1000, 2000] });
      const caseId = cases[0].Id;
      data.own('Case', caseId);
      // Step 4 explicitly requires an empty applicant, although the edit form
      // requires one when creating a complaint. Prepare that state via the API.
      await data.update('Case', caseId, {
        Contact: { dataValueType: 0, value: null },
        Status: guid(await data.lookup('CaseStatus', 'На рассмотрении')),
      });
      await page.reload();
      await use({ data, caseId, caseNumber, clientId, productId, productName });
    } finally {
      await data.attachCreatedRecords();
    }
  }, { timeout: 180_000 }],
});

export { expect };
