#!/usr/bin/env node

/**
 * Bundle size analysis script for CI/CD
 * 
 * This script analyzes the built bundle files and generates a report
 * with size information including gzipped sizes.
 */

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { gzipSync } from 'zlib'

/**
 * Recursively find all JS files in a directory
 */
function findJsFiles(dir, fileList = []) {
  const files = readdirSync(dir)
  
  files.forEach(file => {
    const filePath = join(dir, file)
    const stat = statSync(filePath)
    
    if (stat.isDirectory()) {
      findJsFiles(filePath, fileList)
    } else if (extname(file) === '.js') {
      fileList.push(filePath)
    }
  })
  
  return fileList
}

/**
 * Analyze a single bundle file
 */
function analyzeBundle(filePath) {
  const content = readFileSync(filePath)
  const size = content.length
  const gzipSize = gzipSync(content).length
  
  return {
    name: filePath.replace(/^dist\//, ''),
    size,
    gzipSize,
  }
}

/**
 * Generate bundle size report
 */
function generateReport(distPath = 'dist') {
  if (!existsSync(distPath)) {
    console.error(`Error: dist directory not found at ${distPath}`)
    process.exit(1)
  }
  
  const jsFiles = findJsFiles(distPath)
  const bundles = jsFiles.map(analyzeBundle)
  
  const totalSize = bundles.reduce((sum, bundle) => sum + bundle.size, 0)
  const totalGzipSize = bundles.reduce((sum, bundle) => sum + bundle.gzipSize, 0)
  
  const report = {
    timestamp: new Date().toISOString(),
    commit: process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || 'unknown',
    bundles,
    totalSize,
    totalGzipSize,
  }
  
  return report
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

/**
 * Print report to console
 */
function printReport(report) {
  console.log('\n📦 Bundle Size Report')
  console.log('═'.repeat(60))
  console.log(`Timestamp: ${report.timestamp}`)
  console.log(`Commit: ${report.commit}`)
  console.log('─'.repeat(60))
  
  report.bundles.forEach(bundle => {
    console.log(`\n${bundle.name}`)
    console.log(`  Size: ${formatBytes(bundle.size)}`)
    console.log(`  Gzipped: ${formatBytes(bundle.gzipSize)}`)
  })
  
  console.log('\n' + '─'.repeat(60))
  console.log(`Total Size: ${formatBytes(report.totalSize)}`)
  console.log(`Total Gzipped: ${formatBytes(report.totalGzipSize)}`)
  console.log('═'.repeat(60))
  
  // Check threshold for initial bundle only (not lazy-loaded chunks)
  // Initial bundle includes: index, react-vendor, Layout, and other non-lazy chunks
  const initialBundles = report.bundles.filter(b => {
    const name = b.name.toLowerCase()
    // Exclude lazy-loaded routes and modals
    return !name.includes('page-') && 
           !name.includes('modal-') && 
           !name.includes('video-') &&
           !name.includes('atproto-')
  })
  
  const initialGzipSize = initialBundles.reduce((sum, b) => sum + b.gzipSize, 0)
  const maxGzipSizeKB = 500
  const maxGzipSizeBytes = maxGzipSizeKB * 1024
  
  console.log(`\nInitial Bundle (non-lazy): ${formatBytes(initialGzipSize)}`)
  console.log(`Lazy-Loaded Chunks: ${formatBytes(report.totalGzipSize - initialGzipSize)}`)
  
  if (initialGzipSize > maxGzipSizeBytes) {
    console.log(`\n❌ ERROR: Initial bundle size ${formatBytes(initialGzipSize)} exceeds threshold of ${formatBytes(maxGzipSizeBytes)}`)
    return false
  } else {
    console.log(`\n✅ Initial bundle size ${formatBytes(initialGzipSize)} is within threshold of ${formatBytes(maxGzipSizeBytes)}`)
    return true
  }
}

/**
 * Main function
 */
function main() {
  const args = process.argv.slice(2)
  const distPath = args[0] || 'dist'
  const outputPath = args[1] || 'bundle-size-report.json'
  
  console.log(`Analyzing bundles in ${distPath}...`)
  
  const report = generateReport(distPath)
  
  // Save report to file
  writeFileSync(outputPath, JSON.stringify(report, null, 2))
  console.log(`\nReport saved to ${outputPath}`)
  
  // Print report
  const withinThreshold = printReport(report)
  
  // Exit with error code if threshold exceeded
  if (!withinThreshold) {
    process.exit(1)
  }
}

main()
