/**
 * 实时油价查询脚本 - 增强版
 * 兼容 Surge、Loon、Quantumult X
 * 原作者：@RS0485，修改：@keywos，优化：Gemini
 * 更新日志：
 * - 修复省份页面无法解析的问题（增加智能提示）
 * - 优化正则匹配逻辑，不再强制匹配"(元)"字符
 * - 修正 User-Agent 为移动端
 */

class GasPriceQuery {
    constructor() {
        this.defaultRegion = 'shanxi-3/xian';
        this.baseUrl = 'http://m.qiyoujiage.com';
        this.storageKey = 'yj';
        this.headers = {
            'Referer': 'http://m.qiyoujiage.com/',
            // 必须伪装成手机，否则页面结构可能不同
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
        };
    }

    /**
     * 获取地区配置
     */
    getRegion() {
        if (typeof $argument !== 'undefined' && $argument.trim()) {
            return $argument.trim();
        }
        try {
            const storedRegion = $persistentStore?.read(this.storageKey);
            if (storedRegion && storedRegion.trim()) {
                console.log(`[配置] 使用存储的地区: ${storedRegion}`);
                return storedRegion.trim();
            }
        } catch (error) {
            console.log(`[配置] 读取存储失败: ${error.message}`);
        }
        return this.defaultRegion;
    }

    /**
     * 解析油价数据
     * 优化：增强正则宽容度，匹配 <dt> 和 <dd> 之间的任意空白字符
     */
    parsePrices(htmlData) {
        // 核心优化：
        // 1. \s* 允许标签前后有换行或空格
        // 2. [^0-9]* 允许数字前有货币符号或其他杂字符
        // 3. ([\d\.]+) 只捕获数字和小数点
        const priceRegex = /<dt>\s*(.*?油)\s*<\/dt>[\s\S]*?<dd>[^0-9]*([\d\.]+)/g;
        const prices = [];
        let match;

        while ((match = priceRegex.exec(htmlData)) !== null) {
            if (match[1] && match[2]) {
                const name = match[1].trim();
                // 过滤掉非标准油品（如 CNG 或 纯数字项），只保留常用油品
                if (name.match(/92|95|98|0号/)) {
                    prices.push({
                        name: name,
                        value: `${match[2].trim()} 元/升`
                    });
                }
            }
        }
        return prices;
    }

    /**
     * 解析价格调整信息
     */
    parseAdjustmentInfo(htmlData) {
        // 优化正则，匹配更宽松
        const adjustRegex = /<div class="tishi">\s*<span>(.*?)<\/span>[\s\S]*?<br\/>([\s\S]*?)<br\/>/;
        const match = htmlData.match(adjustRegex);

        if (!match || match.length < 3) {
            return ''; // 解析失败返回空字符串，让后续逻辑处理
        }

        try {
            // 清理 HTML 标签和多余空格
            const dateRaw = match[1].replace(/&nbsp;/g, '').trim();
            const infoRaw = match[2].replace(/&nbsp;/g, '').trim();
            const fullText = `${dateRaw} ${infoRaw}`;

            // 提取关键日期
            let adjustDate = '';
            const dateMatch = fullText.match(/(\d{1,2}月\d{1,2}日)/);
            if (dateMatch) adjustDate = `${dateMatch[1]} 24时`;

            // 提取趋势
            let trend = '';
            if (/下调|下跌|降/.test(fullText)) trend = '📉 下跌';
            else if (/上调|上涨|涨/.test(fullText)) trend = '📈 上涨';
            else if (/搁浅/.test(fullText)) trend = '⚖️ 搁浅';

            // 提取幅度
            let adjustValue = '';
            const valueMatch = fullText.match(/([\d\.]+)元\/[升吨]/);
            if (valueMatch) {
                 adjustValue = valueMatch[0];
            } else if (trend === '⚖️ 搁浅') {
                adjustValue = '0元';
            } else {
                // 如果没匹配到具体金额，尝试提取文本中的范围
                 const rangeMatch = fullText.match(/([\d\.]+-[\d\.]+)元/);
                 if(rangeMatch) adjustValue = rangeMatch[0];
            }
            
            // 组装结果
            if (adjustDate && trend) {
                return `${adjustDate} ${trend} ${adjustValue}`;
            }
            return fullText; // 如果正则提取失败，返回原始文本

        } catch (error) {
            console.log(`[解析] 调价信息解析错误: ${error.message}`);
            return '调价信息解析异常';
        }
    }

    formatContent(prices, adjustmentInfo) {
        // 始终只取前3个（通常是 89/92, 95, 98/0号）
        const priceLines = prices.slice(0, 3).map(p => `${p.name}：${p.value}`);
        
        if (adjustmentInfo) {
            return [...priceLines, `\n${adjustmentInfo}`].join('\n');
        }
        return priceLines.join('\n');
    }

    async query() {
        const region = this.getRegion();
        const queryUrl = `${this.baseUrl}/${region}.shtml`;
        
        console.log(`[执行] 开始查询: ${queryUrl}`);

        $httpClient.get({
            url: queryUrl,
            headers: this.headers,
            timeout: 8000
        }, (error, response, data) => {
            this.handleResponse(error, response, data, region);
        });
    }

    handleResponse(error, response, data, region) {
        if (error) {
            this.sendError('网络请求失败', '请检查网络连接');
            return;
        }

        if (response.status !== 200) {
            this.sendError('服务器异常', `状态码: ${response.status}`);
            return;
        }

        try {
            // 1. 尝试解析价格
            const prices = this.parsePrices(data);
            
            // 2. 智能错误诊断
            if (prices.length === 0) {
                console.log('[错误] 未解析到价格数据');
                
                // 检查是否是因为只填了省份
                if (!region.includes('/')) {
                    this.sendError('配置错误', `您填写的 "${region}" 似乎是省份。\n请精确到城市，例如: sichuan/chengdu`);
                    return;
                }
                
                this.sendError('解析失败', '网站结构变更或地区代码错误');
                return;
            }

            const adjustmentInfo = this.parseAdjustmentInfo(data);
            const content = this.formatContent(prices, adjustmentInfo);

            $done({
                title: '今日油价',
                content: content,
                icon: 'fuelpump.fill',
                'icon-color': '#CA3A05'
            });

        } catch (e) {
            console.log(`[异常] 处理逻辑出错: ${e.message}`);
            this.sendError('脚本执行异常', e.message);
        }
    }

    sendError(title, msg) {
        $done({
            title: title,
            content: msg,
            icon: 'exclamationmark.triangle.fill',
            'icon-color': '#FF3B30'
        });
    }
}

// 启动入口
const gasPrice = new GasPriceQuery();
gasPrice.query();
