/**
 * トピック選択モジュール
 * topics.json からトピックを選択・管理
 * 曜日ベースのカテゴリ自動選択に対応
 */
import fs from 'fs/promises';
import { PATHS } from './config.js';
import { logger } from './logger.js';
import type { Topic, TopicsData, CategoryType, CategoryConfig, DayOfWeek } from './types.js';

export class TopicSelector {
  private topicsData: TopicsData | null = null;

  /**
   * topics.json を読み込み
   */
  async loadTopics(): Promise<TopicsData> {
    if (this.topicsData) {
      return this.topicsData;
    }

    try {
      const data = await fs.readFile(PATHS.topics, 'utf-8');
      this.topicsData = JSON.parse(data) as TopicsData;
      logger.info(`${this.topicsData.topics.length} 件のトピックを読み込みました`);
      return this.topicsData;
    } catch (error) {
      logger.error('topics.json の読み込みに失敗しました');
      throw error;
    }
  }

  /**
   * 次のトピックを取得（曜日ベース、順次、またはランダム）
   */
  async getNextTopic(): Promise<Topic> {
    const data = await this.loadTopics();
    const { topics, settings, categories } = data;

    if (topics.length === 0) {
      throw new Error('トピックが見つかりません');
    }

    let selectedTopic: Topic;

    if (settings.rotationMode === 'weekday' && categories) {
      // 曜日ベースの選択
      selectedTopic = await this.getTopicByWeekday(data);
    } else if (settings.rotationMode === 'random') {
      // ランダム選択
      const newIndex = Math.floor(Math.random() * topics.length);
      selectedTopic = topics[newIndex];
      await this.updateLastUsedIndex(newIndex);
    } else {
      // 順次選択
      const newIndex = (settings.lastUsedIndex + 1) % topics.length;
      selectedTopic = topics[newIndex];
      await this.updateLastUsedIndex(newIndex);
    }

    logger.info(`トピックを選択: ${selectedTopic.title} (${selectedTopic.category})`);
    return selectedTopic;
  }

  /**
   * 曜日に基づいてトピックを選択
   */
  private async getTopicByWeekday(data: TopicsData): Promise<Topic> {
    const today = new Date();
    const dayOfWeek = today.getDay() as DayOfWeek; // 0=日曜, 1=月曜, ...
    const dayNames = ['日曜', '月曜', '火曜', '水曜', '木曜', '金曜', '土曜'];

    logger.info(`今日は${dayNames[dayOfWeek]}です`);

    // 今日のカテゴリを特定
    const todayCategory = data.categories?.find((cat) =>
      cat.scheduledDays.includes(dayOfWeek)
    );

    if (!todayCategory) {
      logger.warn(`${dayNames[dayOfWeek]}に設定されたカテゴリがありません。全体からランダム選択します`);
      const randomIndex = Math.floor(Math.random() * data.topics.length);
      return data.topics[randomIndex];
    }

    logger.info(`今日のカテゴリ: ${todayCategory.nameJp}`);

    // そのカテゴリのトピックをフィルタ
    const categoryTopics = data.topics.filter(
      (t) => t.category === todayCategory.id
    );

    if (categoryTopics.length === 0) {
      logger.warn(`カテゴリ "${todayCategory.nameJp}" にトピックがありません。全体からランダム選択します`);
      const randomIndex = Math.floor(Math.random() * data.topics.length);
      return data.topics[randomIndex];
    }

    // カテゴリ内で順次選択（最も使用回数が少ないものを選択）
    const sortedTopics = [...categoryTopics].sort((a, b) => {
      const countA = a.usedCount || 0;
      const countB = b.usedCount || 0;
      return countA - countB;
    });

    const selectedTopic = sortedTopics[0];

    // 使用回数を更新
    await this.incrementUsedCount(selectedTopic.id);

    return selectedTopic;
  }

  /**
   * トピックの使用回数をインクリメント
   */
  private async incrementUsedCount(topicId: string): Promise<void> {
    if (!this.topicsData) return;

    const topic = this.topicsData.topics.find((t) => t.id === topicId);
    if (topic) {
      topic.usedCount = (topic.usedCount || 0) + 1;
      topic.lastUsedAt = new Date().toISOString();

      try {
        await fs.writeFile(
          PATHS.topics,
          JSON.stringify(this.topicsData, null, 2),
          'utf-8'
        );
        logger.debug(`トピック "${topicId}" の使用回数を更新しました`);
      } catch (error) {
        logger.warn('使用回数の更新に失敗しました');
      }
    }
  }

  /**
   * 今日のカテゴリ設定を取得
   */
  async getTodayCategory(): Promise<CategoryConfig | null> {
    const data = await this.loadTopics();
    const dayOfWeek = new Date().getDay() as DayOfWeek;
    return data.categories?.find((cat) => cat.scheduledDays.includes(dayOfWeek)) || null;
  }

  /**
   * 特定のIDのトピックを取得
   */
  async getTopicById(id: string): Promise<Topic | null> {
    const data = await this.loadTopics();
    return data.topics.find((t) => t.id === id) || null;
  }

  /**
   * カテゴリでフィルタしてトピックを取得
   */
  async getTopicsByCategory(category: string): Promise<Topic[]> {
    const data = await this.loadTopics();
    return data.topics.filter((t) =>
      t.category.toLowerCase().includes(category.toLowerCase())
    );
  }

  /**
   * 最後に使用したインデックスを更新
   */
  private async updateLastUsedIndex(index: number): Promise<void> {
    if (!this.topicsData) {
      return;
    }

    this.topicsData.settings.lastUsedIndex = index;

    try {
      await fs.writeFile(
        PATHS.topics,
        JSON.stringify(this.topicsData, null, 2),
        'utf-8'
      );
      logger.debug(`lastUsedIndex を ${index} に更新しました`);
    } catch (error) {
      logger.warn('lastUsedIndex の更新に失敗しました');
    }
  }

  /**
   * 新しいトピックを追加
   */
  async addTopic(topic: Topic): Promise<void> {
    const data = await this.loadTopics();

    // 重複チェック
    if (data.topics.some((t) => t.id === topic.id)) {
      throw new Error(`トピックID "${topic.id}" は既に存在します`);
    }

    data.topics.push(topic);

    await fs.writeFile(PATHS.topics, JSON.stringify(data, null, 2), 'utf-8');
    this.topicsData = data;

    logger.success(`トピックを追加しました: ${topic.title}`);
  }

  /**
   * ローテーションモードを切り替え
   */
  async setRotationMode(mode: 'sequential' | 'random' | 'weekday'): Promise<void> {
    const data = await this.loadTopics();
    data.settings.rotationMode = mode;

    await fs.writeFile(PATHS.topics, JSON.stringify(data, null, 2), 'utf-8');
    this.topicsData = data;

    const modeNames = {
      sequential: '順次選択',
      random: 'ランダム',
      weekday: '曜日ベース',
    };
    logger.info(`ローテーションモードを「${modeNames[mode]}」に変更しました`);
  }

  /**
   * 全トピックの一覧を取得
   */
  async listAllTopics(): Promise<{ id: string; title: string; category: string }[]> {
    const data = await this.loadTopics();
    return data.topics.map((t) => ({
      id: t.id,
      title: t.title,
      category: t.category,
    }));
  }
}

export const topicSelector = new TopicSelector();
