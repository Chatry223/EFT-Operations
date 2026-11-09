'use strict';

const fs = require('fs');
const path = require('path');
const { EconomyGuard } = require('./engine');
const { AdminPanelServer } = require('./admin-panel');
const { OperationsService } = require('./operations/service');
const { Fika243OperationsAdapter } = require('./operations/fika243-adapter');
const { OperationsClientApi } = require('./operations/client-api');
const { RewardDeliveryService } = require('./operations/reward-delivery');

class SptEconomyGuardMod {
    constructor() {
        this.modDir = path.resolve(__dirname, '..');
        this.guard = null;
    }

    preSptLoad(container) {
        const config = this.loadConfig();
        if (config.operations && config.operations.enabled !== false && config.operations.clientApiEnabled !== false) {
            this.operationsClientApi = new OperationsClientApi({ logger: console });
            this.operationsClientApi.register(container);
        }
    }

    loadConfig() {
        const configPath = path.join(this.modDir, 'config', 'config.json');
        const defaults = {
            enabled: true,
            mode: 'audit',
            dataDirectory: 'SPT-EconomyGuard-Data',
            price: { maxOvervalueRatio: 20, minUndervalueRatio: 0.05, referenceDisagreementRatio: 5, allowSingleReferenceSourceForBlocking: false, minimumReferenceRoubles: 100, unknownItemReviewThresholdRoubles: 1000000, marketReviewOvervalueRatio: 10, marketReviewUndervalueRatio: 0.1 },
            trader: { blockInvalidPaymentScheme: true, maxSellPayoutMultiplier: 3, sellPayoutSafetyFactor: 1.35 },
            flea: { blockSelfPurchase: true, blockPaymentMismatch: true, blockExtremePrice: true, maxTrackedEventsInMemory: 20000, pairWindowMinutes: 10, pairCaseThreshold: 5, cycleWindowHours: 24 },
            restrictions: { enabled: true },
            fence: { absoluteMaxPayoutRoubles: 50000000, blockAbsoluteCap: true },
            diagnostics: { traceTransactions: true },
            notifications: {
                enabled: true,
                prefix: 'BRONSON IS WATCHING YOU',
                separator: '\n',
                includeCaseId: true,
                messages: {}
            },
            storage: { auditRetentionDays: 60, ledgerRetentionDays: 180, caseRetentionDays: 90, maxFileSizeMb: 8 },
            adminPanel: { enabled: true, host: '127.0.0.1', port: 6970 },
            statusBoard: { enabled: true, host: '0.0.0.0', port: 1234 },
            operations: { enabled: true, clientApiEnabled: true, ranks: [] }
        };
        try {
            const incoming = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            return merge(defaults, incoming);
        } catch (err) {
            console.error(`[EconomyGuard] Config could not be read; defaults used: ${err.message}`);
            return defaults;
        }
    }

    postDBLoad(container) {
        const config = this.loadConfig();
        let logger = console;
        let databaseServer = null;
        let paymentHelper = null;
        let configServer = null;
        let inventoryConfig = null;
        let launcherController = null;
        let saveServer = null;
        let fikaPresenceService = null;
        try { logger = container.resolve('PrimaryLogger'); } catch (_) {
            try { logger = container.resolve('WinstonLogger'); } catch (_) { /* console fallback */ }
        }
        try { databaseServer = container.resolve('DatabaseServer'); } catch (_) { /* DB lookup fallback is available on service instances */ }
        try { paymentHelper = container.resolve('PaymentHelper'); } catch (_) { /* dynamic discovery also runs from hooked instances */ }
        try { configServer = container.resolve('ConfigServer'); } catch (_) { /* some builds expose config through services */ }
        try { inventoryConfig = configServer && configServer.getConfig('spt-inventory'); } catch (_) { inventoryConfig = null; }
        try { launcherController = container.resolve('LauncherController'); } catch (_) { /* launcher account provisioning unavailable */ }
        try { saveServer = container.resolve('SaveServer'); } catch (_) { /* profiles may be unavailable until later */ }
        try { fikaPresenceService = container.resolve('FikaPresenceService'); } catch (_) { /* Fika is optional; live presence remains unavailable without it */ }
        if (!inventoryConfig) { try { inventoryConfig = configServer && configServer.getConfig('inventory'); } catch (_) { inventoryConfig = null; } }

        this.guard = new EconomyGuard(this.modDir, config, logger, { databaseServer, paymentHelper, configServer, inventoryConfig, launcherController, saveServer, fikaPresenceService });
        this.operations = config.operations && config.operations.enabled === false ? null : new OperationsService(this.guard.storage.baseDir, logger, config.operations || {});
        this.fikaOperationsAdapter = this.operations ? new Fika243OperationsAdapter({ modDir: this.modDir, operations: this.operations, logger }) : null;
        if (this.fikaOperationsAdapter) this.fikaOperationsAdapter.install(container);
        let mailSendService = null;
        let hashUtil = null;
        let databaseService = null;
        try { mailSendService = container.resolve('MailSendService'); } catch (_) { /* reward delivery remains pending if mail is unavailable */ }
        try { hashUtil = container.resolve('HashUtil'); } catch (_) { /* reward delivery remains pending if hash utility is unavailable */ }
        try { databaseService = container.resolve('DatabaseService'); } catch (_) { /* reward delivery remains pending if item database is unavailable */ }
        this.rewardDelivery = this.operations ? new RewardDeliveryService({ operations: this.operations, saveServer, mailSendService, hashUtil, databaseService, logger }) : null;
        if (this.operations && config.operations && config.operations.clientApiEnabled !== false) {
            let httpResponseUtil = null;
            try { httpResponseUtil = container.resolve('HttpResponseUtil'); } catch (_) { /* response helper is optional in test/minimal containers */ }
            if (!this.operationsClientApi) this.operationsClientApi = new OperationsClientApi({ logger });
            this.operationsClientApi.operations = this.operations;
            this.operationsClientApi.saveServer = saveServer;
            this.operationsClientApi.httpResponseUtil = httpResponseUtil;
            this.operationsClientApi.logger = logger;
            if (!this.operationsClientApi.registered) this.operationsClientApi.register(container);
        }
        this.guard.registerHooks(container);
        try {
            this.adminPanel = new AdminPanelServer(this.modDir, this.guard, logger, config.adminPanel || {}, { launcherController, saveServer, fikaPresenceService, operations: this.operations, fikaOperationsAdapter: this.fikaOperationsAdapter, rewardDelivery: this.rewardDelivery });
            this.adminPanel.start();
        } catch (err) {
            this.guard.health.adminPanel = { enabled: false, error: err.message };
            this.guard.health.warnings.push(`Admin panel failed to start: ${err.message}`);
            this.guard.writeHealth();
            this.guard.log('error', `Admin panel startup failed: ${err.stack || err.message}`);
        }
        this.startStatusBoard(container, config, { saveServer, configServer, databaseServer });
        if (this.guard.isProtect()) {
            this.guard.log('warn', 'PROTECT mode enabled. Only high-confidence price anomalies and exact server-side payment mismatches are blocked.');
        } else {
            this.guard.log('info', `AUDIT mode enabled. Economic anomalies will be logged only.`);
        }
        this.guard.log('info', `Data directory: ${this.guard.storage.baseDir}`);
        this.guard.log('info', `Recognized money TPL count: ${this.guard.moneyTpls.size} (RUB/USD/EUR/GP plus discovered custom currencies)`);
        const fikaItemSending = this.fikaOperationsAdapter && this.fikaOperationsAdapter.getStatus().itemSending;
        if (fikaItemSending && fikaItemSending.configured && fikaItemSending.enabled === false) {
            this.guard.log('info', 'Fika Item Sending is disabled in fika.jsonc; the separate item-transfer route is currently closed.');
        } else if (fikaItemSending && fikaItemSending.configured && fikaItemSending.enabled === true) {
            this.guard.log('warn', 'Fika Item Sending is enabled but is not hooked by EconomyGuard. Disable allowItemSending in fika.jsonc until a version-specific transfer hook is implemented and tested.');
        } else {
            this.guard.log('warn', 'Could not verify Fika allowItemSending in fika.jsonc. EconomyGuard does not monitor that transfer route; verify that the setting is false.');
        }
        this.guard.log('info', 'Transaction callbacks are instrumented at prototype scope so already-created SPT DI instances are covered.');
    }

    // The public status site is an isolated add-on: any failure here is logged and ignored so the firewall,
    // access control and admin panel keep running exactly as before.
    startStatusBoard(container, config, services) {
        try {
            const { StatusBoard } = require('./board');
            let sptPort = 6969;
            try { const http = services.configServer && services.configServer.getConfig('spt-http'); if (http && Number(http.port)) sptPort = Number(http.port); } catch (_) { /* default */ }
            const adminPort = Number(config.adminPanel && config.adminPanel.port) || 6970;
            this.board = new StatusBoard({ modDir: this.modDir, guard: this.guard, logger: this.guard.logger, seed: config.statusBoard || {}, services, reservedPorts: [sptPort, adminPort] });
            if (this.adminPanel) this.adminPanel.board = this.board;
            this.board.start(container).catch(err => this.guard.log('warn', `Status site not started: ${err && err.message}`));
        } catch (err) {
            this.guard.log('warn', `Status site disabled: ${err && err.message}`);
        }
    }
}

function merge(base, incoming) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    for (const [key, value] of Object.entries(incoming || {})) {
        if (value && typeof value === 'object' && !Array.isArray(value) && base && typeof base[key] === 'object' && !Array.isArray(base[key])) {
            out[key] = merge(base[key], value);
        } else out[key] = value;
    }
    return out;
}

module.exports = { mod: new SptEconomyGuardMod() };
