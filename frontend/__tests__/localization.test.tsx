import React from 'react';
import { render } from '@testing-library/react';
import { IntlProvider } from 'react-intl';

// Localization catalog and helpers under test
import {
  messages,
  SUPPORTED_LOCALES,
  REQUIRED_KEYS,
  validateCatalog,
  getMessagesForLocale,
} from '../src/i18n/catalog';

// Components rendering pool and transaction copy
import { PoolCard } from '../src/components/PoolCard';
import { TransactionRow } from '../src/components/TransactionRow';

const CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
const POOL_ID = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const AMOUNT = '1234567.8901234';
const DATE_ISO = '2024-03-15T12:34:56Z';

const samplePool = {
  contractId: CONTRACT_ID,
  poolId: POOL_ID,
  totalLiquidity: AMOUNT,
  createdAt: DATE_ISO,
  status: 'active' as const,
};

const sampleTransaction = {
  contractId: CONTRACT_ID,
  amount: AMOUNT,
  timestamp: DATE_ISO,
  status: 'completed' as const,
  type: 'deposit' as const,
};

function renderWithLocale(locale: string, node: React.ReactNode) {
  return render(
    <IntlProvider locale={locale} messages={getMessagesForLocale(locale)}>
      {node}
    </IntlProvider>,
  );
}

describe('localization catalog', () => {
  it('defines a source catalog with all required keys', () => {
    expect(messages).toBeDefined();
    for (const key of REQUIRED_KEYS) {
      expect(messages).toHaveProperty(key);
    }
  });

  it('passes catalog validation for every supported locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const result = validateCatalog(locale);
      expect(result.valid).toBe(true);
      expect(result.missingKeys).toEqual([]);
      expect(result.invalidPlurals).toEqual([]);
    }
  });

  it('fails validation when a required key is missing', () => {
    const result = validateCatalog('en', { omit: ['pool.status.active'] });
    expect(result.valid).toBe(false);
    expect(result.missingKeys).toContain('pool.status.active');
  });

  it('fails validation on invalid plural forms', () => {
    const result = validateCatalog('en', {
      override: { 'transaction.count': '{count, plural, one {# tx} bogus {# tx}}' },
    });
    expect(result.valid).toBe(false);
    expect(result.invalidPlurals.length).toBeGreaterThan(0);
  });
});

describe('pool copy snapshots', () => {
  it.each(SUPPORTED_LOCALES)('renders pool card for locale %s', (locale) => {
    const { asFragment } = renderWithLocale(locale, <PoolCard pool={samplePool} />);
    expect(asFragment()).toMatchSnapshot(`pool-card-${locale}`);
  });

  it.each(SUPPORTED_LOCALES)(
    'keeps contract identifiers and numeric values unlocalized in pool card (%s)',
    (locale) => {
      const { container } = renderWithLocale(locale, <PoolCard pool={samplePool} />);
      const text = container.textContent ?? '';
      expect(text).toContain(CONTRACT_ID);
      expect(text).toContain(POOL_ID);
      expect(text).toContain(AMOUNT);
    },
  );

  it('renders pluralized pool status copy correctly', () => {
    const { getByTestId } = renderWithLocale('en', <PoolCard pool={samplePool} />);
    expect(getByTestId('pool-status')).toHaveTextContent(/active/i);
  });
});

describe('transaction copy snapshots', () => {
  it.each(SUPPORTED_LOCALES)('renders transaction row for locale %s', (locale) => {
    const { asFragment } = renderWithLocale(
      locale,
      <TransactionRow transaction={sampleTransaction} />,
    );
    expect(asFragment()).toMatchSnapshot(`transaction-row-${locale}`);
  });

  it.each(SUPPORTED_LOCALES)(
    'keeps contract identifiers and numeric values unlocalized in transaction row (%s)',
    (locale) => {
      const { container } = renderWithLocale(
        locale,
        <TransactionRow transaction={sampleTransaction} />,
      );
      const text = container.textContent ?? '';
      expect(text).toContain(CONTRACT_ID);
      expect(text).toContain(AMOUNT);
    },
  );

  it('renders pluralized transaction count copy correctly', () => {
    const { getByTestId } = renderWithLocale(
      'en',
      <TransactionRow transaction={sampleTransaction} count={1} />,
    );
    expect(getByTestId('transaction-count')).toHaveTextContent(/1 transaction/i);
  });
});

describe('RTL locale snapshots', () => {
  const rtlLocales = SUPPORTED_LOCALES.filter((l) => l.startsWith('ar') || l.startsWith('he'));

  it('has at least one RTL locale configured', () => {
    expect(rtlLocales.length).toBeGreaterThan(0);
  });

  it.each(rtlLocales)('renders pool card in RTL locale %s', (locale) => {
    const { asFragment, container } = renderWithLocale(locale, <PoolCard pool={samplePool} />);
    expect(asFragment()).toMatchSnapshot(`pool-card-rtl-${locale}`);
    const text = container.textContent ?? '';
    expect(text).toContain(CONTRACT_ID);
    expect(text).toContain(AMOUNT);
  });

  it.each(rtlLocales)('renders transaction row in RTL locale %s', (locale) => {
    const { asFragment, container } = renderWithLocale(
      locale,
      <TransactionRow transaction={sampleTransaction} />,
    );
    expect(asFragment()).toMatchSnapshot(`transaction-row-rtl-${locale}`);
    const text = container.textContent ?? '';
    expect(text).toContain(CONTRACT_ID);
    expect(text).toContain(AMOUNT);
  });
});

describe('long-text locale snapshots', () => {
  const LONG_TEXT_LOCALES = ['de', 'fi', 'hu'];

  it.each(LONG_TEXT_LOCALES)('renders pool card with long text for locale %s', (locale) => {
    const { asFragment, container } = renderWithLocale(locale, <PoolCard pool={samplePool} />);
    expect(asFragment()).toMatchSnapshot(`pool-card-long-${locale}`);
    const text = container.textContent ?? '';
    expect(text).toContain(CONTRACT_ID);
    expect(text).toContain(AMOUNT);
  });

  it.each(LONG_TEXT_LOCALES)('renders transaction row with long text for locale %s', (locale) => {
    const { asFragment, container } = renderWithLocale(
      locale,
      <TransactionRow transaction={sampleTransaction} />,
    );
    expect(asFragment()).toMatchSnapshot(`transaction-row-long-${locale}`);
    const text = container.textContent ?? '';
    expect(text).toContain(CONTRACT_ID);
    expect(text).toContain(AMOUNT);
  });
});