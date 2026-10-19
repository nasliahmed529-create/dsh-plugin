window.__ModuleLoader__.load({
  id: /*__PACKAGE_NAME__*/,
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var ReactDOM = require("react-dom");

    /*__POLICY__*/

    /**
     * 输入框下方「计费（人民币）」读数，浏览器半边。
     *
     * 注册进 `conversation.composer.dock`（会话作用域的 list 槽位，即输入框卡片
     * 下方那一行：「N 轮 M 步 · tok/s」「X tok · 缓存命中 Y%」以及各连接器插件的
     * 积分读数）。本条目显示当前会话按 DeepSeek 官方人民币价目表估算的费用，
     * 并按北京时间的峰/谷时段自动切换单价；点开是分桶明细、当前时段、距切换
     * 倒计时与规则出处。
     *
     * 数据全部来自标准属性：`useProjection('tokenUsage')`（累计 token 桶）与
     * `useProjection('modelSelection')`（provider/model），不发起任何网络请求，
     * 也不接触任何密钥。
     */

    /** 本插件拥有的 locale 命名空间。 */
    var NS = "billing-meter";
    /** 输入框下方的环境条目槽位。 */
    var SLOT = "conversation.composer.dock";
    /** 条目键：新 id 追加在官方统计条目旁，不会顶掉别人的格子。 */
    var ENTRY_ID = "billing";
    /** 排序：官方 usage（1）之后、连接器积分读数（10）之前。 */
    var ENTRY_ORDER = 2;

    /** 文案。zh 为默认，en 跟随界面语言。 */
    var COPY = {
      zh: {
        "entry.label": "计费",
        "pill.aria": "本会话计费 ¥{amount}，当前{tier}时段",
        "tier.peak": "高峰",
        "tier.offpeak": "空闲",
        "panel.title": "会话计费（人民币）",
        "panel.estimate": "估算",
        "panel.period": "当前时段",
        "panel.period.peak": "高峰 {window}",
        "panel.period.offpeak": "空闲（高峰价的 50%）",
        "panel.switch": "距切换",
        "panel.switch.value": "{countdown} 后转{next}",
        "panel.switch.none": "—",
        "panel.model": "计费模型",
        "panel.cacheHit": "缓存命中输入",
        "panel.cacheMiss": "未命中输入",
        "panel.cacheWrite": "缓存写入",
        "panel.output": "输出",
        "panel.breakdown": "{tokens} tok × ¥{rate}/M = ¥{cost}",
        "panel.total": "合计（当前时段价）",
        "panel.peakTotal": "若全按高峰价",
        "panel.footer": "规则：北京时间周一至周五 09:00–12:00、14:00–18:00 为高峰（中国法定节假日除外），其余时段为空闲；空闲价为高峰价的 50%。",
        "panel.source": "价格来源：{date} 核对 · ",
        "panel.reference": "当前模型非 DeepSeek 官方直连，金额按官方价目表参考估算。",
        "panel.uncertain": "该模型的官方计费口径存在矛盾（价格页与 2026-09-10 更新日志不一致），金额仅供参考。",
        "panel.calendar": "{year} 年节假日日历未收录，已按工作日估算。",
        "panel.unit": "元/百万 tokens",
      },
      en: {
        "entry.label": "Billing",
        "pill.aria": "This session costs ¥{amount} at the current {tier} rate",
        "tier.peak": "peak",
        "tier.offpeak": "off-peak",
        "panel.title": "Session billing (CNY)",
        "panel.estimate": "estimate",
        "panel.period": "Current period",
        "panel.period.peak": "Peak {window}",
        "panel.period.offpeak": "Off-peak (50% of peak)",
        "panel.switch": "Next switch",
        "panel.switch.value": "{countdown} to {next}",
        "panel.switch.none": "—",
        "panel.model": "Priced model",
        "panel.cacheHit": "Cache-hit input",
        "panel.cacheMiss": "Cache-miss input",
        "panel.cacheWrite": "Cache write",
        "panel.output": "Output",
        "panel.breakdown": "{tokens} tok × ¥{rate}/M = ¥{cost}",
        "panel.total": "Total (current period)",
        "panel.peakTotal": "All at peak price",
        "panel.footer": "Rule: Beijing time Mon–Fri 09:00–12:00 and 14:00–18:00 are peak (excluding Chinese statutory holidays); all other times are off-peak at 50% of the peak price.",
        "panel.source": "Prices: checked {date} · ",
        "panel.reference": "This model is not served by the official DeepSeek API; the amount is a reference estimate at official prices.",
        "panel.uncertain": "Official billing for this model is contradictory (pricing page vs the 2026-09-10 changelog); the amount is only a reference.",
        "panel.calendar": "The holiday calendar does not cover {year}; weekday estimation applied.",
        "panel.unit": "CNY per million tokens",
      },
    };

    /**
     * 插件样式。
     *
     * 计费 pill 的字号/行高/颜色不是“差不多”，而是对齐同排官方统计 pill 的实测
     * 计算值（2026-10-19 DSH 0.1.5-rc.2 desktop：12px / 20px / font-weight 400 /
     * color: var(--dsw-alias-label-tertiary)）。官方 pill 的 12px 不来自
     * `--dsh-content-font-size-secondary`（该变量在本机算出 13px），所以这里直接
     * 写死 12px，保证与「N 轮 M 步」「X tok · 缓存命中 Y%」完全一致。
     */
    var CSS = [
      ".dsh-bill-anchor{min-width:0;display:inline-flex;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}",
      ".dsh-bill-pill{box-sizing:border-box;max-width:100%;color:inherit;font-family:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Hiragino Sans GB\",\"Microsoft YaHei\",\"Helvetica Neue\",Helvetica,Arial,sans-serif);font-size:12px;font-weight:400;font-style:normal;line-height:20px;font-variant-numeric:tabular-nums;white-space:nowrap;background:0 0;border:none;border-radius:24px;align-items:center;gap:6px;padding:1px 8px;display:inline-flex;cursor:pointer}",
      ".dsh-bill-pill:hover,.dsh-bill-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
      ".dsh-bill-amount{font-variant-numeric:tabular-nums}",
      ".dsh-bill-sep{color:var(--dsw-alias-separator-primary)}",
      ".dsh-bill-tier{color:inherit}",
      ".dsh-bill-panel{z-index:1100;box-sizing:border-box;position:fixed;background:var(--dsw-specific-menu);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-secondary);cursor:default;border:0;border-radius:12px;padding:16px;font-size:12px;line-height:18px;width:max-content;min-width:min(320px,100vw - 24px);max-width:min(440px,100vw - 24px)}",
      ".dsh-bill-title{color:var(--dsw-alias-label-primary);justify-content:space-between;gap:16px;margin-bottom:8px;font-weight:500;display:flex}",
      ".dsh-bill-titleLabel{align-items:center;gap:6px;min-width:0;display:inline-flex}",
      ".dsh-bill-glyph{display:inline-grid;place-items:center;flex:none;width:14px;height:14px;font-size:12px;font-weight:600;line-height:1}",
      ".dsh-bill-titleValue{font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".dsh-bill-rule{border-top:.5px solid var(--dsw-alias-border-l2);margin-bottom:10px}",
      ".dsh-bill-details{color:var(--dsw-alias-label-tertiary);grid-template-columns:auto minmax(0,1fr);gap:6px 16px;margin:0;display:grid}",
      ".dsh-bill-details dt,.dsh-bill-details dd{min-width:0;margin:0}",
      ".dsh-bill-details dd{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;text-align:right;overflow-wrap:anywhere}",
      ".dsh-bill-details dd.dsh-bill-total{color:var(--dsw-alias-label-primary);font-weight:500}",
      ".dsh-bill-foot{margin-top:10px;border-top:.5px solid var(--dsw-alias-border-l2);padding-top:8px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;max-width:360px}",
      ".dsh-bill-foot a{color:inherit;text-decoration:underline}",
      ".dsh-bill-note{color:var(--dsw-alias-state-warn-primary);margin-top:4px}",
    ].join("");

    /**
     * 安装本插件样式表（只装一次，随插件卸载移除）。
     * @returns 移除 style 元素的清理函数。
     */
    function installStyles() {
      var el = document.createElement("style");
      el.setAttribute("data-dsh-billing-meter", "");
      el.textContent = CSS;
      document.head.appendChild(el);
      return function disposeStyles() {
        if (el.parentNode !== null) el.parentNode.removeChild(el);
      };
    }

    /**
     * 一个按固定间隔刷新的「现在」时间戳，用来驱动峰/谷切换与倒计时。
     * @param intervalMs - 刷新间隔。
     * @returns 当前 epoch 毫秒。
     */
    function useNow(intervalMs) {
      var pair = React.useState(function () {
        return Date.now();
      });
      var now = pair[0];
      var setNow = pair[1];
      React.useEffect(
        function () {
          var timer = setInterval(function () {
            setNow(Date.now());
          }, intervalMs);
          return function () {
            clearInterval(timer);
          };
        },
        [intervalMs],
      );
      return now;
    }

    /**
     * 用当前会话投影渲染计费读数。
     * @param props - 槽位标准属性加上注入的 t。
     * @returns pill 与（展开时）portal 弹层；无法计价时不渲染。
     */
    function BillingPill(props) {
      var t = props.t;
      var useProjection = props.useProjection;
      var usage = typeof useProjection === "function" ? useProjection("tokenUsage") : undefined;
      var selection = typeof useProjection === "function" ? useProjection("modelSelection") : undefined;

      var openPair = React.useState(false);
      var open = openPair[0];
      var setOpen = openPair[1];
      var now = useNow(open ? 1000 : 30000);

      var triggerRef = React.useRef(null);
      var panelRef = React.useRef(null);

      React.useEffect(
        function () {
          if (!open) return undefined;
          var onPointerDown = function (event) {
            var trigger = triggerRef.current;
            var panel = panelRef.current;
            if (trigger !== null && trigger.contains(event.target)) return;
            if (panel !== null && panel.contains(event.target)) return;
            setOpen(false);
          };
          var onKeyDown = function (event) {
            if (event.key === "Escape") setOpen(false);
          };
          document.addEventListener("pointerdown", onPointerDown, true);
          document.addEventListener("keydown", onKeyDown);
          return function () {
            document.removeEventListener("pointerdown", onPointerDown, true);
            document.removeEventListener("keydown", onKeyDown);
          };
        },
        [open],
      );

      var buckets = usageOf(usage);
      var selected =
        selection !== null && selection !== undefined
          ? selection.next !== null && selection.next !== undefined
            ? selection.next
            : selection.lastUsed
          : undefined;
      var model = resolveModel(selected !== null && selected !== undefined ? selected.model : undefined);
      var tokenTotal =
        buckets.uncachedInputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens;
      if (model === null || tokenTotal === 0) return null;

      var status = statusAt(now);
      var price = priceAt(model, status.period);
      var cost = costOf(buckets, price.effective);
      var peakCost = status.period === "peak" ? cost.total : costOf(buckets, model.peakPrice).total;
      var tier = status.period === "peak" ? t("tier.peak") : t("tier.offpeak");
      var nextTier = status.period === "peak" ? t("tier.offpeak") : t("tier.peak");
      var amountText = formatYuan(cost.total);
      var countdown =
        status.msUntilSwitch === null
          ? t("panel.switch.none")
          : t("panel.switch.value", { countdown: formatCountdown(status.msUntilSwitch), next: nextTier });
      var windowText = formatWindow(status.window);

      var pill = React.createElement(
        "button",
        {
          type: "button",
          ref: triggerRef,
          className: "dsh-bill-pill",
          "aria-haspopup": "dialog",
          "aria-expanded": open,
          "aria-label": t("pill.aria", { amount: amountText, tier: tier }),
          onClick: function () {
            setOpen(!open);
          },
        },
        React.createElement("span", { className: "dsh-bill-amount" }, "¥" + amountText),
        React.createElement("span", { className: "dsh-bill-sep", "aria-hidden": true }, "·"),
        React.createElement("span", { className: "dsh-bill-tier" }, tier),
      );

      var panel = null;
      if (open) {
        var rect = triggerRef.current === null ? null : triggerRef.current.getBoundingClientRect();
        var panelStyle =
          rect === null
            ? { left: "50%", top: "50%", transform: "translate(-50%, -50%)" }
            : {
                left: Math.min(Math.max(rect.left + rect.width / 2, 12), Math.max(12, window.innerWidth - 12)),
                bottom: Math.max(12, window.innerHeight - rect.top + 8),
                transform: "translateX(-50%)",
              };

        var rows = [];
        rows.push([
          t("panel.period"),
          status.period === "peak" ? t("panel.period.peak", { window: windowText }) : t("panel.period.offpeak"),
        ]);
        rows.push([t("panel.switch"), countdown]);
        rows.push([
          t("panel.model"),
          model.label + (selected !== null && selected !== undefined ? " · " + selected.provider : ""),
        ]);
        var breakdown = function (tokens, rate, amount) {
          return t("panel.breakdown", {
            tokens: formatInt(tokens),
            rate: formatRate(rate),
            cost: formatYuan(amount),
          });
        };
        rows.push([
          t("panel.cacheHit"),
          breakdown(buckets.cacheReadTokens, price.effective.cacheHit, cost.cacheHit),
        ]);
        rows.push([
          t("panel.cacheMiss"),
          breakdown(
            buckets.uncachedInputTokens,
            price.effective.cacheMiss,
            cost.cacheMiss,
          ),
        ]);
        if (buckets.cacheWriteTokens > 0) {
          rows.push([
            t("panel.cacheWrite"),
            breakdown(buckets.cacheWriteTokens, price.effective.cacheMiss, cost.cacheWrite),
          ]);
        }
        rows.push([t("panel.output"), breakdown(buckets.outputTokens, price.effective.output, cost.output)]);
        rows.push([t("panel.total"), "¥" + formatYuan(cost.total), true]);
        if (status.period !== "peak") {
          rows.push([t("panel.peakTotal"), "¥" + formatYuan(peakCost)]);
        }

        var details = [];
        for (var index = 0; index < rows.length; index += 1) {
          var row = rows[index];
          details.push(React.createElement("dt", { key: "k" + index }, row[0]));
          details.push(
            React.createElement("dd", { key: "v" + index, className: row[2] ? "dsh-bill-total" : undefined }, row[1]),
          );
        }

        var foot = React.createElement(
          "div",
          { className: "dsh-bill-foot" },
          React.createElement("div", null, t("panel.footer")),
          React.createElement(
            "div",
            null,
            t("panel.source", { date: POLICY.verifiedAt }),
            " ",
            React.createElement(
              "a",
              { href: POLICY.source.url, target: "_blank", rel: "noreferrer noopener" },
              POLICY.source.label,
            ),
          ),
          selected !== null && selected !== undefined && selected.provider !== "deepseek-account"
            ? React.createElement("div", { className: "dsh-bill-note" }, t("panel.reference"))
            : null,
          model.pricingUncertain === true
            ? React.createElement("div", { className: "dsh-bill-note" }, t("panel.uncertain"))
            : null,
          status.calendarCovered
            ? null
            : React.createElement("div", { className: "dsh-bill-note" }, t("panel.calendar", { year: status.year })),
        );

        panel = ReactDOM.createPortal(
          React.createElement(
            "div",
            {
              ref: panelRef,
              className: "dsh-bill-panel",
              role: "dialog",
              "aria-label": t("panel.title"),
              style: panelStyle,
            },
            React.createElement(
              "div",
              { className: "dsh-bill-title" },
              React.createElement(
                "span",
                { className: "dsh-bill-titleLabel" },
                React.createElement("span", { className: "dsh-bill-glyph", "aria-hidden": true }, "¥"),
                t("panel.title"),
              ),
              React.createElement("span", { className: "dsh-bill-titleValue" }, "¥" + amountText),
            ),
            React.createElement("div", { className: "dsh-bill-rule", "aria-hidden": true }),
            React.createElement("dl", { className: "dsh-bill-details" }, details),
            foot,
          ),
          document.body,
        );
      }

      return React.createElement("span", { className: "dsh-bill-anchor" }, pill, panel);
    }

    /** Cordis 插件名。 */
    var name = "billing-meter";

    /** 浏览器半边依赖的服务。 */
    var inject = ["slots", "locale"];

    /**
     * 挂载计费读数。
     * @param ctx - 浏览器插件上下文。
     */
    function apply(ctx) {
      var t = ctx.locale.bind(NS);

      ctx.effect(installStyles, "billing-meter: styles");
      ctx.effect(
        function registerCopy() {
          return ctx.locale.register(NS, COPY);
        },
        "billing-meter: copy",
      );

      ctx.effect(
        function mountPill() {
          var dispose = ctx.slots.inject(SLOT, function register() {
            return ctx.slots.register(
              {
                name: SLOT,
                id: ENTRY_ID,
                order: ENTRY_ORDER,
                label: function label() {
                  return ctx.locale.bind(NS)("entry.label");
                },
                locale: NS,
                inject: function injected() {
                  return { t: ctx.locale.bind(NS) };
                },
              },
              BillingPill,
            );
          });
          return function disposePill() {
            if (typeof dispose === "function") dispose();
          };
        },
        "billing-meter: pill",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;
    return module.exports;
  },
});
