'use strict';

const ROUBLE_TPL = '5449016a4bdc2d6f028b456f';
const MAX_MAIL_ITEMS = 100;

class RewardDeliveryService {
    constructor({ operations, saveServer, mailSendService, hashUtil, databaseService, logger } = {}) {
        this.operations = operations || null;
        this.saveServer = saveServer || null;
        this.mailSendService = mailSendService || null;
        this.hashUtil = hashUtil || null;
        this.databaseService = databaseService || null;
        this.logger = logger || console;
    }

    deliverGroup(groupId) {
        if (!this.operations || !this.operations.state) return [];
        const awards = this.operations.state.awards.filter(award => award.groupId === groupId && award.status === 'pending_delivery');
        return awards.map(award => this.deliverAward(award));
    }

    deliverAward(award) {
        const now = new Date().toISOString();
        try {
            const hasInventoryRewards = Number(award.roubles) > 0 || (Array.isArray(award.items) && award.items.length > 0);
            if (!hasInventoryRewards) {
                award.status = 'delivered';
                award.deliveryMethod = 'points_only';
                award.deliveredAt = now;
                this.persist();
                return { awardId: award.id, status: award.status, itemCount: 0 };
            }
            if (!this.saveServer || typeof this.saveServer.getProfiles !== 'function') throw new Error('SAVE_SERVER_UNAVAILABLE');
            const sessionId = this.findSessionId(award.profileId);
            if (!sessionId) throw new Error('PLAYER_PROFILE_NOT_FOUND');

            const items = this.buildMailItems(award);
            if (items.length === 0) {
                award.status = 'delivered';
                award.deliveryMethod = 'points_only';
                award.deliveredAt = now;
                this.persist();
                return { awardId: award.id, status: award.status, itemCount: 0 };
            }
            if (!this.mailSendService || typeof this.mailSendService.sendSystemMessageToPlayer !== 'function') {
                throw new Error('MAIL_SEND_SERVICE_UNAVAILABLE');
            }

            // Persist the in-flight marker before sending. If the process stops after the
            // mail is sent but before the delivered marker is saved, do not auto-retry and
            // risk duplicating the reward; leave it for administrator reconciliation.
            award.status = 'delivering';
            award.deliveryStartedAt = now;
            award.deliveryAttempt = (Number(award.deliveryAttempt) || 0) + 1;
            this.persist();

            const mission = this.operations.state.missions.find(item => item.id === award.missionId);
            const title = mission && mission.title ? mission.title : 'Field Operation';
            this.mailSendService.sendSystemMessageToPlayer(
                sessionId,
                'Operation completed: ' + title + '. Your approved rewards are attached.',
                items,
                604800
            );

            award.status = 'delivered';
            award.deliveryMethod = 'system_mail';
            award.deliveredItemCount = items.length;
            award.deliveredAt = new Date().toISOString();
            delete award.deliveryError;
            this.persist();
            return { awardId: award.id, status: award.status, itemCount: items.length };
        } catch (error) {
            award.status = 'delivery_attention_required';
            award.deliveryError = String(error && error.message || error).slice(0, 300);
            award.deliveryFailedAt = new Date().toISOString();
            this.persist();
            if (this.logger && typeof this.logger.warn === 'function') {
                this.logger.warn('[EFT Operations] Reward delivery requires admin attention for award ' + award.id + ': ' + award.deliveryError);
            }
            return { awardId: award.id, status: award.status, error: award.deliveryError };
        }
    }

    findSessionId(profileId) {
        const profiles = this.saveServer.getProfiles() || {};
        for (const [sessionId, profile] of Object.entries(profiles)) {
            const characters = profile && profile.characters || {};
            if (characters.pmc && characters.pmc._id === profileId) return sessionId;
            if (characters.scav && characters.scav._id === profileId) return sessionId;
        }
        return null;
    }

    buildMailItems(award) {
        const items = [];
        const templates = this.databaseService && typeof this.databaseService.getItems === 'function'
            ? this.databaseService.getItems()
            : null;
        if (!templates) throw new Error('ITEM_DATABASE_UNAVAILABLE');
        if (Number(award.roubles) > 0) this.appendStacks(items, ROUBLE_TPL, Number(award.roubles), templates);
        for (const reward of Array.isArray(award.items) ? award.items : []) {
            this.appendStacks(items, String(reward.tpl || ''), Number(reward.count), templates);
        }
        if (items.length > MAX_MAIL_ITEMS) throw new Error('REWARD_MAIL_ITEM_LIMIT_EXCEEDED');
        return items;
    }

    appendStacks(output, tpl, count, templates) {
        if (!/^[a-f0-9]{24}$/i.test(tpl) || !Number.isSafeInteger(count) || count < 1) {
            throw new Error('INVALID_REWARD_ITEM');
        }
        const template = templates[tpl];
        if (!template) throw new Error('REWARD_ITEM_TEMPLATE_NOT_FOUND:' + tpl);
        const maxStack = Math.max(1, Math.floor(Number(template._props && template._props.StackMaxSize) || 1));
        let remaining = count;
        while (remaining > 0) {
            const stackCount = Math.min(remaining, maxStack);
            const item = { _id: this.hashUtil.generate(), _tpl: tpl, upd: {} };
            if (maxStack > 1) item.upd.StackObjectsCount = stackCount;
            output.push(item);
            remaining -= stackCount;
            if (output.length > MAX_MAIL_ITEMS) throw new Error('REWARD_MAIL_ITEM_LIMIT_EXCEEDED');
        }
    }

    persist() {
        if (this.operations && typeof this.operations.persist === 'function') this.operations.persist();
    }
}

module.exports = { RewardDeliveryService, ROUBLE_TPL };
