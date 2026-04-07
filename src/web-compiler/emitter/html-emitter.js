'use strict';

/**
 * HTML emitter — step 14a.
 *
 * Converts a render plan page into an HTML string.
 * Output rules (from api_implementation_brief):
 *   - semantic elements only
 *   - data-component, data-variant, data-region attributes on each component root
 *   - no inline styles from content payload
 *   - CSS class names per naming contract (c-{component}, c-{component}__{slot})
 */

/**
 * Escape text content to prevent XSS from plain-text slots.
 */
function escapeHtml(str) {
    if (typeof str !== 'string') return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/**
 * Render a single slot to HTML.
 * If resolved_value is a string that looks like HTML (starts with <), emit raw.
 * Otherwise escape it.
 */
function renderSlotContent(slot) {
    const val = slot.resolved_value;
    if (!slot.is_rendered || val === null || val === undefined) return '';

    if (Array.isArray(val)) {
        return renderArraySlot(slot.slot_id, val);
    }

    if (slot.slot_id === 'brand' && val && typeof val === 'object') {
        const label = val.label || val.name || val.text || val.url || '/';
        return escapeHtml(String(label));
    }

    if (typeof val === 'string') {
        // Sanitised HTML fragment — emit raw
        if (val.trim().startsWith('<')) return val;
        return escapeHtml(val);
    }

    return escapeHtml(String(val));
}

function renderArraySlot(slotId, values) {
    if (slotId === 'items') {
        return values.map(item => {
            if (!item || typeof item !== 'object') return `<li>${escapeHtml(String(item))}</li>`;
            const url = item.url || item.href || item.link || '#';
            const label = item.label || item.title || item.text || item.name || url;
            return `<li><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></li>`;
        }).join('\n');
    }

    if (slotId === 'groups') {
        return values.map(group => {
            if (!group || typeof group !== 'object') return '';
            const heading = group.heading ? `<h2>${escapeHtml(group.heading)}</h2>` : '';
            const body = group.body ? `<p>${escapeHtml(group.body)}</p>` : '';
            const links = Array.isArray(group.links)
                ? `<ul>${group.links.map(link => {
                    const url = link.url || link.href || '#';
                    const label = link.label || link.text || url;
                    return `<li><a href="${escapeHtml(url)}">${escapeHtml(label)}</a></li>`;
                }).join('')}</ul>`
                : '';
            return `<section class="c-footer__group">${heading}${body}${links}</section>`;
        }).join('\n');
    }

    return values.map(item => renderArrayItem(item)).join('\n');
}

function renderArrayItem(item) {
    if (item && typeof item === 'object') {
        if (item.html !== undefined || item.body !== undefined || item.heading !== undefined) {
            let out = '';
            if (item.heading) out += `<h2 class="c-body-section__heading">${escapeHtml(item.heading)}</h2>\n`;
            if (item.html) out += `<div class="c-body-section__content">${item.html}</div>`;
            if (item.body) out += `<p class="c-body-section__content">${escapeHtml(item.body)}</p>`;
            if (Array.isArray(item.items) && item.items.length > 0) {
                out += `<ul class="c-body-section__list">${item.items.map(v => `<li>${escapeHtml(String(v))}</li>`).join('')}</ul>`;
            }
            return out;
        }
        if (item.url && item.title) {
            let out = `<article class="c-result-item">\n`;
            out += `  <h2 class="c-result-item__title"><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></h2>\n`;
            if (item.summary) out += `  <p class="c-result-item__summary">${escapeHtml(item.summary)}</p>\n`;
            out += `</article>`;
            return out;
        }
        return escapeHtml(JSON.stringify(item));
    }
    return escapeHtml(String(item));
}

/**
 * Build HTML attribute string from an attributes object.
 */
function buildAttrs(attrs) {
    if (!attrs) return '';
    return Object.entries(attrs)
        .map(([k, v]) => `${k}="${escapeHtml(String(v))}"`)
        .join(' ');
}

function inferSlotAttributes(slot) {
    if (slot.element !== 'a') return null;
    if (slot.attributes && Object.prototype.hasOwnProperty.call(slot.attributes, 'href')) return null;
    if (slot.slot_id !== 'brand') return null;

    const value = slot.resolved_value;
    if (typeof value === 'string') {
        return { href: value };
    }
    if (value && typeof value === 'object') {
        return { href: value.url || value.href || value.link || '/' };
    }
    return null;
}

/**
 * Render a component instance to HTML.
 */
function renderComponent(instance, regionId) {
    const { dom, data_attributes, styles } = instance;
    const dataAttrs = [
        `data-component="${data_attributes.component}"`,
        `data-variant="${data_attributes.variant}"`,
        `data-region="${regionId}"`,
    ].join(' ');

    let html = `<${dom.root_element} class="${dom.root_class}" ${dataAttrs}>\n`;

    for (const slot of dom.slots || []) {
        if (!slot.is_rendered) continue;

        const slotClass = slot.class_name;
        const mergedAttrs = Object.assign({}, inferSlotAttributes(slot) || {}, slot.attributes || {});
        const extraAttrs = Object.keys(mergedAttrs).length > 0 ? ' ' + buildAttrs(mergedAttrs) : '';
        const content = renderSlotContent(slot);

        if (Array.isArray(slot.resolved_value)) {
            // Collection: wrap in element, content already rendered
            html += `  <${slot.element} class="${slotClass}"${extraAttrs}>\n${content}\n  </${slot.element}>\n`;
        } else {
            html += `  <${slot.element} class="${slotClass}"${extraAttrs}>${content}</${slot.element}>\n`;
        }
    }

    html += `</${dom.root_element}>\n`;
    return html;
}

/**
 * Render a full page from the render plan to an HTML document string.
 *
 * @param {object} page          Page node from render plan
 * @param {object} renderPlan    Full render plan (for resolved_tokens, site info)
 * @returns {string} Full HTML document
 */
function emitPage(page, renderPlan) {
    const { resolved_tokens, site_id } = renderPlan;

    let body = '';
    for (const region of page.regions || []) {
        body += `<!-- region: ${region.region_id} -->\n`;
        for (const instance of region.components || []) {
            body += renderComponent(instance, region.region_id);
        }
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(page.page_id)}</title>
  <link rel="stylesheet" href="site.css">
</head>
<body data-site="${escapeHtml(site_id)}" data-theme="${escapeHtml(resolved_tokens.theme_id)}" data-polish="${escapeHtml(resolved_tokens.polish_profile_id)}">
${body}
<script src="site.js" defer></script>
</body>
</html>`;
}

/**
 * Emit all pages from a render plan.
 *
 * @param {object} renderPlan  render_plan_v1
 * @returns {Array<{filename: string, content: string}>}
 */
function emitHtml(renderPlan) {
    return renderPlan.pages.map(page => ({
        filename: page.slug === '/' ? 'index.html' : `${page.page_id}.html`,
        content:  emitPage(page, renderPlan),
    }));
}

module.exports = { emitHtml, emitPage };
