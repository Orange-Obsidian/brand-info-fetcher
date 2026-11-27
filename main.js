const { Plugin, Modal, Notice, Setting, PluginSettingTab, requestUrl } = require('obsidian');

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // 월~일 순서

class BrandInfoFetcherPlugin extends Plugin {
    settings = { apiKey: '' };

    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: 'fetch-brand-info',
            name: '브랜드 정보 자동 수집',
            callback: () => {
                const file = this.app.workspace.getActiveFile();
                if (!file) {
                    new Notice('활성화된 파일이 없습니다.');
                    return;
                }
                new BrandSearchModal(this.app, this, file).open();
            }
        });

        this.addSettingTab(new BrandFetcherSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({ apiKey: '' }, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async fetchPlaceInfo(query) {
        // Step 1: 매장 검색
        const searchRes = await requestUrl({
            url: `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(query)}&inputtype=textquery&fields=place_id,name&language=ko&key=${this.settings.apiKey}`
        });

        const candidates = searchRes.json.candidates;
        if (!candidates || candidates.length === 0) {
            throw new Error('매장을 찾을 수 없습니다. 매장명을 더 구체적으로 입력해보세요.');
        }

        // Step 2: 상세 정보 조회
        const placeId = candidates[0].place_id;
        const detailRes = await requestUrl({
            url: `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,opening_hours,formatted_address,address_components&language=ko&key=${this.settings.apiKey}`
        });

        return detailRes.json.result;
    }

    parseOpeningHours(openingHours) {
        if (!openingHours?.periods) {
            return { 운영요일: '확인필요', 운영시간: '확인필요', 휴무일: '확인필요' };
        }

        const periods = openingHours.periods;

        // 24시간 영업 체크
        if (periods.length === 1 && !periods[0].close) {
            return { 운영요일: '월·화·수·목·금·토·일', 운영시간: '24시간', 휴무일: '없음' };
        }

        const openDays = new Set(periods.map(p => p.open.day));
        const closedDays = DAY_ORDER.filter(d => !openDays.has(d));

        // 운영요일 문자열
        const 운영요일 = DAY_ORDER.filter(d => openDays.has(d)).map(d => DAY_KO[d]).join('·');

        // 휴무일 문자열
        const 휴무일 = closedDays.length > 0
            ? closedDays.map(d => DAY_KO[d]).join('·') + '요일'
            : '없음';

        // 운영시간 파싱 (요일별 시간이 다를 수 있음)
        const hourMap = new Map();
        for (const period of periods) {
            const open = `${period.open.time.slice(0, 2)}:${period.open.time.slice(2)}`;
            const close = period.close ? `${period.close.time.slice(0, 2)}:${period.close.time.slice(2)}` : '?';
            const timeStr = `${open} ~ ${close}`;
            if (!hourMap.has(timeStr)) hourMap.set(timeStr, []);
            hourMap.get(timeStr).push(period.open.day);
        }

        let 운영시간;
        if (hourMap.size === 1) {
            운영시간 = [...hourMap.keys()][0];
        } else {
            // 요일별로 시간이 다른 경우
            const parts = [];
            for (const [time, days] of hourMap) {
                const daysStr = DAY_ORDER.filter(d => days.includes(d)).map(d => DAY_KO[d]).join('·');
                parts.push(`${daysStr} ${time}`);
            }
            운영시간 = parts.join(' / ');
        }

        return { 운영요일, 운영시간, 휴무일 };
    }

    extractWard(addressComponents) {
        for (const component of addressComponents || []) {
            const name = component.long_name;
            // 한국어 응답 기준 "시부야구" 등 "구"로 끝나는 행정구역
            if (name.endsWith('구') || name.endsWith('区')) {
                return name;
            }
        }
        return '확인필요';
    }
}

class BrandSearchModal extends Modal {
    constructor(app, plugin, file) {
        super(app);
        this.plugin = plugin;
        this.file = file;
        this.query = '';
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: '브랜드 정보 자동 수집' });

        new Setting(contentEl)
            .setName('매장명')
            .setDesc('예: Kapital 恵比寿 Tokyo, Supply Tokyo 元代々木')
            .addText(text => {
                text.setPlaceholder('매장명 입력...')
                    .onChange(value => { this.query = value; });
                text.inputEl.addEventListener('keydown', e => {
                    if (e.key === 'Enter') this.fetchAndFill();
                });
                // 자동 포커스
                setTimeout(() => text.inputEl.focus(), 50);
            });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText('정보 가져오기')
                .setCta()
                .onClick(() => this.fetchAndFill())
            );
    }

    async fetchAndFill() {
        if (!this.plugin.settings.apiKey) {
            new Notice('⚠️ Settings → Brand Info Fetcher에서 API 키를 먼저 입력해주세요.');
            return;
        }
        if (!this.query.trim()) {
            new Notice('매장명을 입력해주세요.');
            return;
        }

        new Notice('정보를 가져오는 중...');
        this.close();

        try {
            const result = await this.plugin.fetchPlaceInfo(this.query);
            const hours = this.plugin.parseOpeningHours(result.opening_hours);
            const ward = this.plugin.extractWard(result.address_components);

            await this.app.fileManager.processFrontMatter(this.file, fm => {
                if (!fm['브랜드']) fm['브랜드'] = result.name;
                fm['장소'] = ward;
                fm['운영요일'] = hours.운영요일;
                fm['운영시간'] = hours.운영시간;
                fm['휴무일'] = hours.휴무일;
            });

            new Notice(`✅ ${result.name} 정보 업데이트 완료!`);

        } catch (err) {
            new Notice(`❌ 오류: ${err.message}`);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

class BrandFetcherSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Brand Info Fetcher 설정' });

        new Setting(containerEl)
            .setName('Google Places API Key')
            .setDesc('Google Cloud Console → Places API 에서 발급. 무료 크레딧으로 충분히 테스트 가능.')
            .addText(text => text
                .setPlaceholder('AIzaSy...')
                .setValue(this.plugin.settings.apiKey)
                .onChange(async value => {
                    this.plugin.settings.apiKey = value;
                    await this.plugin.saveSettings();
                })
            );
    }
}

module.exports = BrandInfoFetcherPlugin;
