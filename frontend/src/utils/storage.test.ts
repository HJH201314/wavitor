/**
 * 工作区存储功能测试脚本
 * 
 * 在浏览器控制台中运行此脚本来测试存储功能
 */

import { storageManager } from './src/utils/storage';

// 测试 1: 初始化存储
async function testInit() {
  console.log('Test 1: Initialize storage');
  try {
    await storageManager.init();
    console.log('✅ Storage initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize storage:', error);
  }
}

// 测试 2: 保存和加载工作区
async function testWorkspace() {
  console.log('\nTest 2: Save and load workspace');
  
  const testWorkspace = {
    fileId: 'test_123',
    fileName: 'test.mp3',
    manualBeats: [1.0, 2.0, 3.0],
    deletedDetectedBeats: [0.5],
    history: [{
      manualBeats: [1.0, 2.0, 3.0],
      deletedDetectedBeats: [0.5],
      timestamp: Date.now(),
      action: 'Test action',
    }],
    historyIndex: 0,
    createdAt: Date.now(),
    lastModified: Date.now(),
  };
  
  try {
    // 保存
    await storageManager.saveWorkspace(testWorkspace);
    console.log('✅ Workspace saved');
    
    // 加载
    const loaded = await storageManager.loadWorkspace('test_123');
    if (loaded && loaded.fileId === 'test_123') {
      console.log('✅ Workspace loaded successfully');
      console.log('   Manual beats:', loaded.manualBeats);
      console.log('   Deleted beats:', loaded.deletedDetectedBeats);
    } else {
      console.error('❌ Loaded workspace data mismatch');
    }
    
    // 清理
    await storageManager.deleteWorkspace('test_123');
    console.log('✅ Workspace deleted');
  } catch (error) {
    console.error('❌ Workspace test failed:', error);
  }
}

// 测试 3: 保存和加载音频文件
async function testAudioFile() {
  console.log('\nTest 3: Save and load audio file (mock)');
  
  try {
    // 创建一个模拟的音频 Blob
    const mockAudioData = new Uint8Array([1, 2, 3, 4, 5]);
    const mockBlob = new Blob([mockAudioData], { type: 'audio/mpeg' });
    const mockFile = new File([mockBlob], 'test.mp3', {
      type: 'audio/mpeg',
      lastModified: Date.now(),
    });
    
    // 保存
    await storageManager.saveAudioFile('test_audio_123', mockFile);
    console.log('✅ Audio file saved');
    
    // 检查是否存在
    const exists = await storageManager.hasAudioFile('test_audio_123');
    if (exists) {
      console.log('✅ Audio file exists check passed');
    } else {
      console.error('❌ Audio file not found');
    }
    
    // 加载
    const loaded = await storageManager.loadAudioFile('test_audio_123');
    if (loaded && loaded.name === 'test.mp3') {
      console.log('✅ Audio file loaded successfully');
      console.log('   File name:', loaded.name);
      console.log('   File size:', loaded.size, 'bytes');
    } else {
      console.error('❌ Loaded audio file data mismatch');
    }
    
    // 清理
    await storageManager.deleteAudioFile('test_audio_123');
    console.log('✅ Audio file deleted');
  } catch (error) {
    console.error('❌ Audio file test failed:', error);
  }
}

// 测试 4: 存储空间信息
async function testStorageInfo() {
  console.log('\nTest 4: Get storage usage info');
  
  try {
    const info = await storageManager.getStorageUsage();
    console.log('✅ Storage info retrieved');
    console.log('   Usage:', (info.usage / 1024 / 1024).toFixed(2), 'MB');
    console.log('   Quota:', (info.quota / 1024 / 1024).toFixed(2), 'MB');
    console.log('   Percentage:', info.percentage.toFixed(2), '%');
  } catch (error) {
    console.error('❌ Storage info test failed:', error);
  }
}

// 运行所有测试
export async function runAllTests() {
  console.log('=== Running Storage Tests ===\n');
  
  await testInit();
  await testWorkspace();
  await testAudioFile();
  await testStorageInfo();
  
  console.log('\n=== All Tests Complete ===');
}

// 在控制台运行: runAllTests()
// 或逐个运行: testInit(), testWorkspace(), etc.
