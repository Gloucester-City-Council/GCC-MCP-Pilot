'use strict';

const { withPage } = require('../browser-pool');
const snapshotStore = require('../snapshot-store');
const { collectDiagnostics, extractPageModel, truncate } = require('../extraction');
const { interactionSnapshotGovernance, errorGovernance } = require('../governance');

// Restricted action vocabulary — no arbitrary JS execution
const ALLOWED_ACTIONS = new Set([
  'click', 'focus', 'press_key', 'type_text', 'select_option',
  'wait_for_selector', 'wait_for_timeout',
]);

const MAX_STEPS = 10;
const MAX_TIMEOUT_MS = 5_000;

async function executeStep(page, step) {
  const { action, selector, value, key, timeout_ms } = step;

  switch (action) {
    case 'click':
      if (!selector) throw new Error('click requires a selector.');
      await page.locator(selector).click({ timeout: MAX_TIMEOUT_MS });
      return { status: 'success' };

    case 'focus':
      if (!selector) throw new Error('focus requires a selector.');
      await page.locator(selector).focus({ timeout: MAX_TIMEOUT_MS });
      return { status: 'success' };

    case 'press_key':
      if (!key) throw new Error('press_key requires a key value.');
      if (selector) {
        await page.locator(selector).press(key, { timeout: MAX_TIMEOUT_MS });
      } else {
        await page.keyboard.press(key);
      }
      return { status: 'success' };

    case 'type_text':
      if (!selector) throw new Error('type_text requires a selector.');
      if (!value) throw new Error('type_text requires a value.');
      await page.locator(selector).fill(String(value), { timeout: MAX_TIMEOUT_MS });
      return { status: 'success' };

    case 'select_option':
      if (!selector) throw new Error('select_option requires a selector.');
      if (!value) throw new Error('select_option requires a value.');
      await page.locator(selector).selectOption(String(value), { timeout: MAX_TIMEOUT_MS });
      return { status: 'success' };

    case 'wait_for_selector':
      if (!selector) throw new Error('wait_for_selector requires a selector.');
      await page.waitForSelector(selector, {
        timeout: Math.min(timeout_ms || MAX_TIMEOUT_MS, MAX_TIMEOUT_MS),
      });
      return { status: 'success' };

    case 'wait_for_timeout': {
      const ms = Math.min(Number(timeout_ms) || 1000, 5000);
      await page.waitForTimeout(ms);
      return { status: 'success' };
    }

    default:
      throw new Error(`Action '${action}' is not permitted. Allowed: ${[...ALLOWED_ACTIONS].join(', ')}`);
  }
}

async function interactAndSnapshot(args) {
  const {
    snapshot_id,
    steps = [],
    capture = {},
    timeout_ms = 30_000,
  } = args || {};

  if (!snapshot_id) {
    return { error: { code: 'SNAPSHOT_EXPIRED', message: 'snapshot_id is required.' } };
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    return { error: { code: 'SELECTOR_INVALID', message: 'steps must be a non-empty array.' } };
  }

  if (steps.length > MAX_STEPS) {
    return { error: { code: 'SELECTOR_INVALID', message: `Maximum ${MAX_STEPS} steps permitted per call.` } };
  }

  // Validate all actions up front
  for (const step of steps) {
    if (!ALLOWED_ACTIONS.has(step.action)) {
      return {
        error: {
          code: 'SELECTOR_INVALID',
          message: `Action '${step.action}' is not permitted. Allowed: ${[...ALLOWED_ACTIONS].join(', ')}`,
        },
      };
    }
  }

  const html = snapshotStore.getArtifact(snapshot_id, 'html');
  if (!html) {
    return {
      error: {
        code: 'SNAPSHOT_EXPIRED',
        message: `Snapshot '${snapshot_id}' not found or has expired. Re-capture with capture_rendered_page_model.`,
        retryable: false,
      },
      governance: errorGovernance('scripted_interaction_snapshot'),
    };
  }

  const baseMetadata = snapshotStore.getMetadata(snapshot_id);

  try {
    return await withPage(
      { viewport: 'desktop', resourceMode: 'balanced', timeoutMs: timeout_ms },
      async (page) => {
        const diagnostics = collectDiagnostics(page);
        await page.setContent(html, { waitUntil: 'domcontentloaded' });

        const trace = [];

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const stepNum = i + 1;

          try {
            const result = await executeStep(page, step);
            trace.push({ step: stepNum, action: step.action, selector: step.selector || null, status: 'success', ...result });
          } catch (stepErr) {
            trace.push({
              step: stepNum,
              action: step.action,
              selector: step.selector || null,
              status: 'failed',
              error: truncate(stepErr.message, 200),
            });
            // Stop on first failure
            break;
          }
        }

        // Capture post-interaction state
        const newSnapshotId = snapshotStore.create({ url: baseMetadata?.url, finalUrl: baseMetadata?.final_url });
        const newHtml = await page.content();
        snapshotStore.setArtifact(newSnapshotId, 'html', newHtml);

        const pageModel = capture.page_model !== false
          ? await extractPageModel(page, { maxTextChars: 4_000 })
          : null;
        if (pageModel) snapshotStore.setArtifact(newSnapshotId, 'page_model', pageModel);

        return {
          base_snapshot_id: snapshot_id,
          new_snapshot_id: newSnapshotId,
          interaction_trace: trace,
          page_model: pageModel,
          diagnostics: diagnostics.flush(),
          governance: interactionSnapshotGovernance(),
        };
      }
    );
  } catch (err) {
    return {
      error: { code: 'RENDER_FAILED', message: truncate(err.message, 300), retryable: true },
      governance: errorGovernance('scripted_interaction_snapshot'),
    };
  }
}

module.exports = { interactAndSnapshot };
