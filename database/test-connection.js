// ============================================
// DATABASE CONNECTION TEST
// Run this to verify your MySQL connection
// ============================================

const db = require('./database');

async function testConnection() {
    console.log('🔍 Testing database connection...\n');
    
    try {
        // Test connection
        await db.connect();
        
        // Test basic query
        console.log('\n🔍 Testing basic query...');
        const result = await db.query('SELECT VERSION() as version, NOW() as current_time');
        console.log('✅ Query successful!');
        console.log(`   MySQL Version: ${result[0].version}`);
        console.log(`   Server Time: ${result[0].current_time}`);
        
        // Check if tables exist
        console.log('\n🔍 Checking database tables...');
        const tables = await db.query('SHOW TABLES');
        
        if (tables.length === 0) {
            console.log('⚠️  No tables found. Please run schema.sql first!');
            console.log('\n   Steps to create tables:');
            console.log('   1. Open MySQL Workbench or command line');
            console.log('   2. Run: mysql -u root -p < database/schema.sql');
            console.log('   3. Or execute schema.sql in MySQL Workbench\n');
        } else {
            console.log(`✅ Found ${tables.length} tables:`);
            tables.forEach(table => {
                const tableName = Object.values(table)[0];
                console.log(`   - ${tableName}`);
            });
        }
        
        // Test stored procedure
        console.log('\n🔍 Testing stored procedures...');
        const procedures = await db.query(
            "SHOW PROCEDURE STATUS WHERE Db = 'secure_exam_browser'"
        );
        console.log(`✅ Found ${procedures.length} stored procedures`);
        
        // Test views
        console.log('\n🔍 Testing views...');
        const views = await db.query(
            "SHOW FULL TABLES WHERE Table_type = 'VIEW'"
        );
        console.log(`✅ Found ${views.length} views`);
        
        console.log('\n✅ All tests passed! Database is ready to use.\n');
        
    } catch (error) {
        console.error('\n❌ Connection test failed!');
        console.error('Error:', error.message);
        console.error('\n💡 Troubleshooting tips:');
        console.error('   1. Make sure MySQL is running');
        console.error('   2. Check username/password in database/config.js');
        console.error('   3. Verify database exists: CREATE DATABASE secure_exam_browser;');
        console.error('   4. Run schema.sql to create tables\n');
    } finally {
        await db.close();
        process.exit();
    }
}

testConnection();
