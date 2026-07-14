import { describe, expect, it } from 'vitest';
import {
  p8ChatCompletionsUrl,
  p8LiveDraftIsBoilerplate,
  p8LiveProviderTimeoutMs,
  p8LowercaseLead,
  parseP8ProviderContent,
} from '../src/index.js';

describe('P8 live synthesis provider timeout', () => {
  it('allows comprehensive local synthesis five minutes by default', () => {
    expect(p8LiveProviderTimeoutMs({})).toBe(300_000);
  });

  it('accepts a bounded operator override', () => {
    expect(
      p8LiveProviderTimeoutMs({ MAMMOTH_P8_PROVIDER_TIMEOUT_MS: '600000' }),
    ).toBe(600_000);
  });

  it.each(['29999', '900001', '1.5', 'not-a-number'])(
    'rejects invalid timeout %s',
    (value) => {
      expect(() =>
        p8LiveProviderTimeoutMs({ MAMMOTH_P8_PROVIDER_TIMEOUT_MS: value }),
      ).toThrow(/must be an integer from 30000 through 900000/u);
    },
  );
});

describe('P8 OpenAI-compatible provider URL', () => {
  it('adds v1 for a root-only Ollama base URL', () => {
    expect(p8ChatCompletionsUrl('http://127.0.0.1:11434').href).toBe(
      'http://127.0.0.1:11434/v1/chat/completions',
    );
  });

  it('preserves OpenRouter api/v1 path prefixes', () => {
    expect(p8ChatCompletionsUrl('https://openrouter.ai/api/v1').href).toBe(
      'https://openrouter.ai/api/v1/chat/completions',
    );
  });

  it('preserves arbitrary provider prefixes before adding v1', () => {
    expect(p8ChatCompletionsUrl('https://provider.example/tenant').href).toBe(
      'https://provider.example/tenant/v1/chat/completions',
    );
  });
});

describe('P8 live prose hygiene', () => {
  it.each([
    'WRI published insights on managing US electricity demand.',
    'The National Wildlife Federation offers programs for high schoolers.',
    'The University of Georgia operates campuses in Athens and Tifton.',
    'Chris Wright serves as Secretary of Energy.',
    'For more information, see the ERCOT profile and regional transmission plan.',
    'Give Online Donate Stocks Advanced Search Data Center Resources.',
    'Follow MSCI Featured Solutions Portfolio Management Sustainability Reporting.',
    'About CAES Personnel Directory Privacy Policy Copyright and Trademarks.',
    'Relevant Work Cities Electric School Buses Deliver More Than Just a Clean Ride.',
    'Reality: Data Centers And Water Usage - Skip to main content Member Login.',
    'AG Actions Database Issues in Focus Home Insights Data Centers and the Grid.',
    'The NWF blog nwf.org Topics Home Our Work Get Involved About Us.',
    'Visit Project Part of Climate Data Centers and Rising Energy Demand.',
    'References https://example.test/one and https://example.test/two.',
    'ABC7 Chicago. https://example.test/report Mahan, J. (2024).',
    'Noise pollution Water use Data centers Human health Authors Neha Gour, George Mason University.',
    'Noise pollution Water use Data centers Human health George Mason University Authors Neha Gour.',
  ])('rejects page chrome or organization metadata: %s', (value) => {
    expect(p8LiveDraftIsBoilerplate(value)).toBe(true);
  });

  it('keeps substantive source passages', () => {
    expect(
      p8LiveDraftIsBoilerplate(
        'A national review found that nearly half of 700 data centers were in census tracts with above-median environmental burdens.',
      ),
    ).toBe(false);
  });

  it('preserves initialisms while joining ordinary sentence leads', () => {
    expect(p8LowercaseLead("RMI's tariff principles protect customers.")).toBe(
      "RMI's tariff principles protect customers.",
    );
    expect(p8LowercaseLead('Data centers use electricity.')).toBe(
      'data centers use electricity.',
    );
  });
});

describe('P8 provider JSON compatibility', () => {
  it('accepts the governed wrapper', () => {
    expect(
      parseP8ProviderContent(
        '{"schemaVersion":"1.0.0","claims":[{"spanId":"span-1","text":"A sufficiently detailed atomic claim."}]}',
      ),
    ).toMatchObject({ schemaVersion: '1.0.0' });
  });

  it('wraps concatenated claim records without changing them', () => {
    expect(
      parseP8ProviderContent(
        '{"spanId":"span-1","text":"First sufficiently detailed atomic claim."}\n{"spanId":"span-2","text":"Second sufficiently detailed atomic claim."}',
      ),
    ).toEqual({
      schemaVersion: '1.0.0',
      claims: [
        {
          spanId: 'span-1',
          text: 'First sufficiently detailed atomic claim.',
        },
        {
          spanId: 'span-2',
          text: 'Second sufficiently detailed atomic claim.',
        },
      ],
    });
  });

  it('normalizes Ollama array output and its claim alias', () => {
    expect(
      parseP8ProviderContent(
        '[{"spanId":"span-1","claim":"First sufficiently detailed atomic claim."},{"spanId":"span-2","claim":"Second sufficiently detailed atomic claim."}]',
      ),
    ).toEqual({
      schemaVersion: '1.0.0',
      claims: [
        {
          spanId: 'span-1',
          claim: 'First sufficiently detailed atomic claim.',
          text: 'First sufficiently detailed atomic claim.',
        },
        {
          spanId: 'span-2',
          claim: 'Second sufficiently detailed atomic claim.',
          text: 'Second sufficiently detailed atomic claim.',
        },
      ],
    });
  });

  it('rejects prose or unrelated JSON records', () => {
    expect(() =>
      parseP8ProviderContent('Here is the answer: {"ok":true}'),
    ).toThrow(/malformed JSON content/u);
  });
});
