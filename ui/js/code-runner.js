// Code Runner - Executes and validates code against test cases
// Supports JavaScript execution in browser environment

class CodeRunner {
    constructor() {
        this.timeout = 2000; // 2 seconds timeout
        this.memoryLimit = 256; // MB (not strictly enforced in browser)
    }

    /**
     * Run code against sample test cases
     * @param {string} code - User's code
     * @param {Array} testCases - Array of test cases (visible ones only)
     * @param {string} language - Programming language
     * @returns {Object} - Result with passed tests and output
     */
    async runSampleTests(code, testCases, language = 'javascript') {
        if (language !== 'javascript') {
            return {
                success: false,
                error: `Language ${language} is not supported for browser execution. Only JavaScript is available.`,
                results: []
            };
        }

        const results = [];
        const sampleTests = testCases.filter(tc => !tc.hidden);

        for (const testCase of sampleTests) {
            const result = await this.executeTestCase(code, testCase);
            results.push(result);
        }

        const passedCount = results.filter(r => r.passed).length;
        const totalCount = results.length;

        return {
            success: true,
            passed: passedCount,
            total: totalCount,
            results: results,
            allPassed: passedCount === totalCount
        };
    }

    /**
     * Submit code and run all test cases (including hidden ones)
     * @param {string} code - User's code
     * @param {Array} testCases - All test cases
     * @param {string} language - Programming language
     * @returns {Object} - Full submission result
     */
    async submitCode(code, testCases, language = 'javascript') {
        if (language !== 'javascript') {
            return {
                success: false,
                error: `Language ${language} is not supported for browser execution.`,
                status: 'Error',
                results: []
            };
        }

        const results = [];
        let totalTime = 0;

        for (const testCase of testCases) {
            const result = await this.executeTestCase(code, testCase);
            results.push(result);
            totalTime += result.executionTime || 0;
        }

        const passedCount = results.filter(r => r.passed).length;
        const totalCount = results.length;
        const allPassed = passedCount === totalCount;

        return {
            success: true,
            status: allPassed ? 'Accepted' : 'Wrong Answer',
            passed: passedCount,
            total: totalCount,
            results: results,
            totalTime: totalTime,
            allPassed: allPassed
        };
    }

    /**
     * Execute code against a single test case
     * @param {string} code - User's code
     * @param {Object} testCase - Single test case
     * @returns {Object} - Test result
     */
    async executeTestCase(code, testCase) {
        const startTime = performance.now();
        
        try {
            // Extract function name from code
            const functionName = this.extractFunctionName(code);
            if (!functionName) {
                throw new Error('Could not extract function name from code');
            }

            // Create isolated execution context
            const sandbox = this.createSandbox(code);
            
            // Get the function from sandbox
            const func = sandbox[functionName];
            if (typeof func !== 'function') {
                throw new Error(`Function ${functionName} not found or not executable`);
            }

            // Execute with timeout
            const result = await this.executeWithTimeout(
                () => {
                    // Call function with test inputs
                    const inputs = Object.values(testCase.input);
                    return func(...inputs);
                },
                this.timeout
            );

            const executionTime = Math.round(performance.now() - startTime);

            // Compare output
            const passed = this.compareOutputs(result, testCase.output);

            return {
                passed: passed,
                input: testCase.input,
                expectedOutput: testCase.output,
                actualOutput: result,
                executionTime: executionTime,
                error: null
            };

        } catch (error) {
            const executionTime = Math.round(performance.now() - startTime);
            
            return {
                passed: false,
                input: testCase.input,
                expectedOutput: testCase.output,
                actualOutput: null,
                executionTime: executionTime,
                error: error.message || 'Runtime Error'
            };
        }
    }

    /**
     * Extract function name from code
     */
    extractFunctionName(code) {
        // Match function declarations: function name(...) or const name = (...) =>
        const patterns = [
            /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/,
            /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/
        ];

        for (const pattern of patterns) {
            const match = code.match(pattern);
            if (match && match[1]) {
                return match[1];
            }
        }

        return null;
    }

    /**
     * Create isolated sandbox for code execution
     */
    createSandbox(code) {
        try {
            // Create function from code string
            const sandboxFunc = new Function(
                'console',
                `
                ${code}
                
                // Return all defined functions and variables
                const exports = {};
                ${this.extractExports(code)}
                return exports;
                `
            );

            // Custom console that doesn't output
            const sandboxConsole = {
                log: () => {},
                error: () => {},
                warn: () => {},
                info: () => {}
            };

            return sandboxFunc(sandboxConsole);
        } catch (error) {
            throw new Error('Syntax Error: ' + error.message);
        }
    }

    /**
     * Extract function names to export
     */
    extractExports(code) {
        const functionMatches = code.matchAll(/function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g);
        const constMatches = code.matchAll(/(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g);
        
        const names = new Set();
        for (const match of functionMatches) names.add(match[1]);
        for (const match of constMatches) names.add(match[1]);

        let exports = '';
        for (const name of names) {
            exports += `try { exports.${name} = ${name}; } catch(e) {}\n`;
        }

        return exports;
    }

    /**
     * Execute function with timeout
     */
    async executeWithTimeout(func, timeout) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error('Time Limit Exceeded'));
            }, timeout);

            try {
                const result = func();
                clearTimeout(timer);
                resolve(result);
            } catch (error) {
                clearTimeout(timer);
                reject(error);
            }
        });
    }

    /**
     * Compare actual output with expected output
     */
    compareOutputs(actual, expected) {
        // Handle null/undefined
        if (actual === null || actual === undefined) {
            return expected === null || expected === undefined;
        }

        // Handle arrays
        if (Array.isArray(expected)) {
            if (!Array.isArray(actual)) return false;
            if (actual.length !== expected.length) return false;
            
            // For arrays of arrays or objects, deep compare
            return this.deepEqual(actual, expected);
        }

        // Handle objects
        if (typeof expected === 'object') {
            return this.deepEqual(actual, expected);
        }

        // Handle primitives
        return actual === expected;
    }

    /**
     * Deep equality check
     */
    deepEqual(a, b) {
        if (a === b) return true;
        
        if (a === null || b === null || a === undefined || b === undefined) {
            return a === b;
        }

        if (typeof a !== typeof b) return false;

        if (Array.isArray(a) && Array.isArray(b)) {
            if (a.length !== b.length) return false;
            for (let i = 0; i < a.length; i++) {
                if (!this.deepEqual(a[i], b[i])) return false;
            }
            return true;
        }

        if (typeof a === 'object' && typeof b === 'object') {
            const keysA = Object.keys(a);
            const keysB = Object.keys(b);
            if (keysA.length !== keysB.length) return false;
            
            for (const key of keysA) {
                if (!keysB.includes(key)) return false;
                if (!this.deepEqual(a[key], b[key])) return false;
            }
            return true;
        }

        return a === b;
    }

    /**
     * Format test results for display
     */
    formatResults(results) {
        let output = '';

        results.results.forEach((result, index) => {
            output += `Test Case ${index + 1}: ${result.passed ? '✓ Passed' : '✗ Failed'}\n`;
            output += `Input: ${JSON.stringify(result.input)}\n`;
            output += `Expected: ${JSON.stringify(result.expectedOutput)}\n`;
            
            if (result.error) {
                output += `Error: ${result.error}\n`;
            } else {
                output += `Output: ${JSON.stringify(result.actualOutput)}\n`;
            }
            
            output += `Time: ${result.executionTime}ms\n`;
            output += '\n';
        });

        output += `\nResult: ${results.passed}/${results.total} test cases passed\n`;

        return output;
    }
}

// Export for use in exam.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CodeRunner;
}
