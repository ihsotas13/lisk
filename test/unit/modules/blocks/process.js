'use strict';

var expect = require('chai').expect;
var async = require('async');
var sinon = require('sinon');
var Promise = require('bluebird');

var node = require('../../../node');
var modulesLoader = require('../../../common/modulesLoader');
var genesisBlock = require('../../../../genesisBlock.json');
var loadTables = require('./processTablesData.json');
var clearDatabaseTable = require('../../../common/globalBefore').clearDatabaseTable;
var DBSandbox = require('../../../common/globalBefore').DBSandbox;
var constants = require('../../../../helpers/constants.js');
var slots = require('../../../../helpers/slots.js');
var blocksData = require('./processBlocks.json');

var forkOneScenarios = require('./forks/forkOneScenarios.json');
var forkThreeScenarios = require('./forks/forkThreeScenarios.json');
var forkFiveScenarios = require('./forks/forkFiveScenarios.json');

var BlockLogic = require('../../../../logic/block.js');

describe('blocks/process', function () {

	var blocksProcess;
	var blockLogic;
	var blocks;
	var blocksVerify;
	var accounts;
	var db;
	var dbSandbox;
	var logger;
	var scope;
	var originalBlockRewardsOffset;
	var sequence;

	var debug;
	var info;
	var warn;
	var error;

	before(function (done) {
		dbSandbox = new DBSandbox(modulesLoader.scope.config.db, 'lisk_test_blocks_process');
		dbSandbox.create(function (err, __db) {
			modulesLoader.db = __db;
			db = __db;
			// Force rewards start at 150-th block
			originalBlockRewardsOffset = node.constants.rewards.offset;
			node.constants.rewards.offset = 150;
			node.initApplication(function (err, __scope) {
				scope = __scope;
				accounts = __scope.modules.accounts;
				blocksProcess = __scope.modules.blocks.process;
				blocksVerify = __scope.modules.blocks.verify;
				blockLogic = __scope.logic.block;
				blocks = __scope.modules.blocks;
				db = __scope.db;
				sequence = __scope.sequence;
				logger = __scope.logger;
				// Set delegates to 4
				constants.activeDelegates = 4;
				slots.delegates = 4;
				done(err);
			}, {db: db});
		});
	});

	beforeEach(function () {
		// Set spies for logger
		logger.debug.reset();
		logger.info.reset();
		logger.warn.reset();
		logger.error.reset();
	});

	after(function (done) {
		async.every([
			'blocks where height > 1',
			'trs where "blockId" != \'6524861224470851795\'',
			'mem_accounts where address in (\'2737453412992791987L\', \'2896019180726908125L\')',
			'forks_stat',
			'votes where "transactionId" = \'17502993173215211070\''
		], function (table, seriesCb) {
			clearDatabaseTable(db, modulesLoader.logger, table, seriesCb);
		}, function (err) {
			if (err) {
				done(err);
			}
			node.constants.rewards.offset = originalBlockRewardsOffset;
			dbSandbox.destroy(modulesLoader.logger);
			node.appCleanup(done);
		});
	});

	beforeEach(function (done) {
		async.series({
			clearTables: function (seriesCb) {
				async.every([
					'blocks where height > 1',
					'trs where "blockId" != \'6524861224470851795\'',
					'mem_accounts where address in (\'2737453412992791987L\', \'2896019180726908125L\')',
					'forks_stat',
					'votes where "transactionId" = \'17502993173215211070\''
				], function (table, seriesCb) {
					clearDatabaseTable(db, modulesLoader.logger, table, seriesCb);
				}, function (err) {
					if (err) {
						return setImmediate(err);
					}
					return setImmediate(seriesCb);
				});
			},
			loadTables: function (seriesCb) {
				async.everySeries(loadTables, function (table, seriesCb) {
					var cs = new db.$config.pgp.helpers.ColumnSet(
						table.fields, {table: table.name}
					);
					var insert = db.$config.pgp.helpers.insert(table.data, cs);
					db.none(insert)
						.then(function () {
							seriesCb(null, true);
						}).catch(function (err) {
							return setImmediate(err);
						});
				}, function (err) {
					if (err) {
						return setImmediate(err);
					}
					return setImmediate(seriesCb);
				});
			}
		}, function (err) {
			if (err) {
				return done(err);
			}
			done();
		});
	});

	/*
	 * Adds a block to blockchain from blocksDataArray, position blockNumber, and logs the
	 * operation from opeartionType: add, restore.
	 */
	function addBlock (blocksDataArray, operationType, blockNumber) {
		it(['should be ok when', operationType, 'block', blockNumber + 1].join(' '), function (done) {
			if (blockNumber === 0) {
				blocks.lastBlock.set(genesisBlock);
			}
			sequence.add = function (cb) {

				var fn = Promise.promisify(cb);

				fn().then(function (err, res) {
					expect(err).to.be.undefined;
					expect(res).to.be.undefined;

					if (blocksDataArray[blockNumber].height % slots.delegates !== 0) {
						expect(debug.args[0][0]).to.equal('Block applied correctly with 0 transactions');
						expect(debug.args[1][0]).to.equal('Performing forward tick');
						expect(info.args[0][0]).to.equal([
							'Received new block id:', blocksDataArray[blockNumber].id,
							'height:', blocksDataArray[blockNumber].height,
							'round:',  slots.getSlotNumber(blocksDataArray[blockNumber].height),
							'slot:', slots.getSlotNumber(blocksDataArray[blockNumber].timestamp),
							'reward:', blocksDataArray[blockNumber].reward
						].join(' '));
					} else {
						// Round change
						expect(debug.args[0][0]).to.equal('Block applied correctly with 0 transactions');
						expect(debug.args[1][0]).to.equal('Summing round');
						expect(debug.args[1][1]).to.equal(1);
						expect(debug.args[2][0]).to.equal('Performing forward tick');
						expect(info.args[0][0]).to.equal([
							'Received new block id:', blocksDataArray[blockNumber].id,
							'height:', blocksDataArray[blockNumber].height,
							'round:',  slots.getSlotNumber(blocksDataArray[blockNumber].height),
							'slot:', slots.getSlotNumber(blocksDataArray[blockNumber].timestamp),
							'reward:', blocksDataArray[blockNumber].reward
						].join(' '));
					}

					done();
				});
			};

			blocksProcess.onReceiveBlock(blocksDataArray[blockNumber]);
		});
	}

	function deleteLastBlock () {

		it('should be ok when deleting last block', function (done) {
			blocks.chain.deleteLastBlock(function (err, cb) {
				if (err) {
					done(err);
				}
				done();
			});
		});
	}

	describe('getCommonBlock()', function () {

		it('should be ok');
	});

	describe('loadBlocksOffset({verify: true}) - no errors', function () {

		it('should load block 2 from database: block without transactions', function (done) {
			blocks.lastBlock.set(genesisBlock);
			blocksProcess.loadBlocksOffset(1, 2, true, function (err, loadedBlock) {
				if (err) {
					return done(err);
				}

				blocks.lastBlock.set(loadedBlock);
				expect(loadedBlock.height).to.be.equal(2);
				done();
			});
		});

		it('should load block 3 from database: block with transactions', function (done) {
			blocksProcess.loadBlocksOffset(1, 3, true, function (err, loadedBlock) {
				if (err) {
					return done(err);
				}

				blocks.lastBlock.set(loadedBlock);
				expect(loadedBlock.height).to.be.equal(3);
				done();
			});
		});
	});

	describe('loadBlocksOffset({verify: true}) - block/transaction errors', function () {

		it('should load block 4 from db and return blockSignature error', function (done) {
			blocksProcess.loadBlocksOffset(1, 4, true, function (err, loadedBlock) {
				if (err) {
					expect(err).equal('Failed to verify block signature');
					return done();
				}

				done(loadedBlock);
			});
		});

		it('should load block 5 from db and return payloadHash error', function (done) {
			blocks.lastBlock.set(loadTables[0].data[2]);

			blocksProcess.loadBlocksOffset(1, 5, true, function (err, loadedBlock) {
				if (err) {
					expect(err).equal('Invalid payload hash');
					return done();
				}

				done(loadedBlock);
			});
		});

		it('should load block 6 from db and return block timestamp error', function (done) {
			blocks.lastBlock.set(loadTables[0].data[3]);

			blocksProcess.loadBlocksOffset(1, 6, true, function (err, loadedBlock) {
				if (err) {
					expect(err).equal('Invalid block timestamp');
					return done();
				}

				done(loadedBlock);
			});
		});

		it('should load block 7 from db and return unknown transaction type error', function (done) {
			blocks.lastBlock.set(loadTables[0].data[4]);

			blocksProcess.loadBlocksOffset(1, 7, true, function (err, loadedBlock) {
				if (err) {
					expect(err).equal('Blocks#loadBlocksOffset error: Unknown transaction type 99');
					return done();
				}

				done(loadedBlock);
			});
		});

		it('should load block 8 from db and return block version error', function (done) {
			blocks.lastBlock.set(loadTables[0].data[5]);

			blocksProcess.loadBlocksOffset(1, 8, true, function (err, loadedBlock) {
				if (err) {
					expect(err).equal('Invalid block version');
					return done();
				}

				done(loadedBlock);
			});
		});

		it('should load block 9 from db and return previousBlock error (fork:1)', function (done) {
			blocks.lastBlock.set(loadTables[0].data[1]);

			blocksProcess.loadBlocksOffset(1, 9, true, function (err, loadedBlock) {
				if (err) {
					expect(err).equal('Invalid previous block: 15335393038826825161 expected: 13068833527549895884');
					return done();
				}

				done(loadedBlock);
			});
		});

		it('should load block 10 from db and return duplicated votes error', function (done) {
			blocks.lastBlock.set(loadTables[0].data[7]);

			blocksProcess.loadBlocksOffset(1, 10, true, function (err, loadedBlock) {
				if (err) {
					expect(err).equal('Failed to validate vote schema: Array items are not unique (indexes 0 and 4)');
					return done();
				}

				done(loadedBlock);
			});
		});
	});

	describe('loadBlocksOffset({verify: false}) - return block/transaction errors', function () {

		it('should clear fork_stat db table', function (done) {
			async.every([
				'forks_stat'
			], function (table, seriesCb) {
				clearDatabaseTable(db, modulesLoader.logger, table, seriesCb);
			}, function (err, result) {
				if (err) {
					done(err);
				}
				done();
			});
		});

		it('should load and process block 4 from db with invalid blockSignature', function (done) {
			blocks.lastBlock.set(loadTables[0].data[1]);

			blocksProcess.loadBlocksOffset(1, 4, false, function (err, loadedBlock) {
				if (err) {
					return done(err);
				}

				expect(loadedBlock.id).equal(loadTables[0].data[2].id);
				expect(loadedBlock.previousBlock).equal(loadTables[0].data[2].previousBlock);
				done();
			});
		});

		it('should load and process block 5 from db with invalid payloadHash', function (done) {
			blocks.lastBlock.set(loadTables[0].data[2]);

			blocksProcess.loadBlocksOffset(1, 5, false, function (err, loadedBlock) {
				if (err) {
					return done(err);
				}

				expect(loadedBlock.id).equal(loadTables[0].data[3].id);
				expect(loadedBlock.previousBlock).equal(loadTables[0].data[3].previousBlock);
				done();
			});
		});

		it('should load and process block 6 from db with invalid block timestamp', function (done) {
			blocks.lastBlock.set(loadTables[0].data[3]);

			blocksProcess.loadBlocksOffset(1, 6, false, function (err, loadedBlock) {
				if (err) {
					done(err);
				}

				expect(loadedBlock.id).equal(loadTables[0].data[4].id);
				expect(loadedBlock.previousBlock).equal(loadTables[0].data[4].previousBlock);
				done();
			});
		});

		it('should load block 7 from db and return unknown transaction type error', function (done) {
			blocks.lastBlock.set(loadTables[0].data[4]);

			blocksProcess.loadBlocksOffset(1, 7, true, function (err, loadedBlock) {
				if (err) {
					expect(err).equal('Blocks#loadBlocksOffset error: Unknown transaction type 99');
					return done();
				}

				done(loadedBlock);
			});
		});

		it('should load and process block 8 from db with invalid block version', function (done) {
			blocks.lastBlock.set(loadTables[0].data[5]);

			blocksProcess.loadBlocksOffset(1, 8, false, function (err, loadedBlock) {
				if (err) {
					done(err);
				}

				expect(loadedBlock.id).equal(loadTables[0].data[6].id);
				expect(loadedBlock.previousBlock).equal(loadTables[0].data[6].previousBlock);
				done();
			});
		});

		it('should load and process block 9 from db with invalid previousBlock (no fork:1)', function (done) {
			blocks.lastBlock.set(loadTables[0].data[1]);

			blocksProcess.loadBlocksOffset(1, 9, false, function (err, loadedBlock) {
				if (err) {
					done(err);
				}

				expect(loadedBlock.id).equal(loadTables[0].data[7].id);
				expect(loadedBlock.previousBlock).equal(loadTables[0].data[7].previousBlock);
				done();
			});
		});

		it('should load and process block 10 from db with duplicated votes', function (done) {
			blocks.lastBlock.set(loadTables[0].data[7]);

			blocksProcess.loadBlocksOffset(1, 10, false, function (err, loadedBlock) {
				if (err) {
					done(err);
				}

				expect(loadedBlock.id).equal(loadTables[0].data[8].id);
				expect(loadedBlock.previousBlock).equal(loadTables[0].data[8].previousBlock);
				done();
			});
		});
	});

	describe('loadBlocksFromPeer()', function () {

		it('should be ok');
	});

	describe('generateBlock()', function () {

		it('should be ok');
	});

	describe('onReceiveBlock (empty transactions)', function () {

		describe('receiveBlock', function () {

			before(function () {
				addBlock(blocksData, 'received', 0);
			});

			describe('validateBlockSlot error - fork 3', function () {

				it('should fail when block generator is not a delegate', function (done) {
					sequence.add = function (cb) {

						var fn = Promise.Promise.promisify(cb);

						fn().catch(function (err, res) {
							expect(err.message).to.equal('Failed to verify slot: 3556603');
							expect(info.args[0][0]).to.equal([
								'Received new block id:', forkThreeScenarios[0].id,
								'height:', forkThreeScenarios[0].height,
								'round:',  slots.getSlotNumber(forkThreeScenarios[0].height),
								'slot:', slots.getSlotNumber(forkThreeScenarios[0].timestamp),
								'reward:', forkThreeScenarios[0].reward
							].join(' '));
							expect(info.args[1][0]).to.equal('Fork');
							expect(info.args[1][1].cause).to.equal(3);
							expect(info.args[1][1].delegate).to.equal(forkThreeScenarios[0].generatorPublicKey);
							expect(info.args[1][1].block.height).to.equal(forkThreeScenarios[0].height);
							expect(info.args[1][1].block.id).to.equal(forkThreeScenarios[0].id);
							expect(info.args[1][1].block.previousBlock).to.equal(forkThreeScenarios[0].previousBlock);
							expect(info.args[1][1].block.timestamp).to.equal(forkThreeScenarios[0].timestamp);
							expect(error.args[0][0]).to.equal('Expected generator: 01389197bbaf1afb0acd47bbfeabb34aca80fb372a8f694a1c0716b3398db746 Received generator: 03e811dda4f51323ac712cd12299410830d655ddffb104f2c9974d90bf8c583a');
							done();
						});
					};

					blocksProcess.onReceiveBlock(forkThreeScenarios[0]);
				});

				it('should fail when block generator is not the calculated slot delegate', function (done) {
					sequence.add = function (cb) {

						var fn = Promise.promisify(cb);

						fn().catch(function (err, res) {
							console.log('resolved with err: ', err);
							expect(err.message).to.equal('Failed to verify slot: 3556603');
							expect(info.args[0][0]).to.equal([
								'Received new block id:', forkThreeScenarios[1].id,
								'height:', forkThreeScenarios[1].height,
								'round:',  slots.getSlotNumber(forkThreeScenarios[1].height),
								'slot:', slots.getSlotNumber(forkThreeScenarios[1].timestamp),
								'reward:', forkThreeScenarios[1].reward
							].join(' '));
							expect(info.args[1][0]).to.equal('Fork');
							expect(info.args[1][1].cause).to.equal(3);
							expect(info.args[1][1].delegate).to.equal(forkThreeScenarios[1].generatorPublicKey);
							expect(info.args[1][1].block.height).to.equal(forkThreeScenarios[1].height);
							expect(info.args[1][1].block.id).to.equal(forkThreeScenarios[1].id);
							expect(info.args[1][1].block.previousBlock).to.equal(forkThreeScenarios[1].previousBlock);
							expect(info.args[1][1].block.timestamp).to.equal(forkThreeScenarios[1].timestamp);
							expect(error.args[0][0]).to.equal('Expected generator: 01389197bbaf1afb0acd47bbfeabb34aca80fb372a8f694a1c0716b3398db746 Received generator: 684a0259a769a9bdf8b82c5fe3054182ba3e936cf027bb63be231cd25d942adb');
							done();
						});
					};

					blocksProcess.onReceiveBlock(forkThreeScenarios[1]);
				});
			});
		});

		describe('receiveForkOne', function () {

			describe('timestamp is greather than previous block', function () {

				it('should be ok when last block stands', function (done) {
					sequence.add = function (cb) {

						var fn = Promise.promisify(cb);

						fn().then(function (err, res) {
							expect(err).to.be.undefined;
							expect(res).to.be.undefined;
							expect(info.args[0][0]).to.equal('Fork');
							expect(info.args[0][1].cause).to.equal(1);
							expect(info.args[0][1].delegate).to.equal(blocksData[1].generatorPublicKey);
							expect(info.args[0][1].block.height).to.equal(blocksData[1].height);
							expect(info.args[0][1].block.id).to.equal(blocksData[1].id);
							expect(info.args[0][1].block.previousBlock).to.equal(blocksData[1].previousBlock);
							expect(info.args[0][1].block.timestamp).to.equal(blocksData[1].timestamp);
							expect(info.args[1][0]).to.equal('Last block stands');
							blocksData[1].previousBlock = previousBlock;
							done();
						});
					};

					var previousBlock = blocksData[1].previousBlock;

					blocksData[1].previousBlock = forkOneScenarios[0].id;
					blocksProcess.onReceiveBlock(blocksData[1]);
				});
			});

			describe('timestamp is lower than previous block', function () {

				addBlock(blocksData, 'received', 1);

				it('should fail when block object normalize', function (done) {
					sequence.add = function (cb) {

						var fn = Promise.promisify(cb);

						fn().catch(function (err) {
							expect(info.args[0][0]).to.equal('Fork');
							expect(info.args[0][1].cause).to.equal(1);
							expect(info.args[0][1].delegate).to.equal(forkOneScenarios[0].generatorPublicKey);
							expect(info.args[0][1].block.height).to.equal(forkOneScenarios[0].height);
							expect(info.args[0][1].block.id).to.equal(forkOneScenarios[0].id);
							expect(info.args[0][1].block.previousBlock).to.equal(forkOneScenarios[0].previousBlock);
							expect(info.args[0][1].block.timestamp).to.equal(forkOneScenarios[0].timestamp);
							expect(info.args[1][0]).to.equal('Last block and parent loses');
							expect(error.args[0][0]).to.equal('Fork recovery failed');
							expect(error.args[0][1]).to.equal(['Failed to validate block schema: Object didn\'t pass validation for format signature:', forkOneScenarios[0].blockSignature].join(' '));
							expect(err.message).to.equal(['Failed to validate block schema: Object didn\'t pass validation for format signature:', forkOneScenarios[0].blockSignature].join(' '));
							forkOneScenarios[0].blockSignature = blockSignature;
							done();
						});
					};

					var blockSignature = forkOneScenarios[0].blockSignature;

					forkOneScenarios[0].blockSignature = 'invalid-block-signature';
					blocksProcess.onReceiveBlock(forkOneScenarios[0]);
				});

				it('should fail when block verify receipt', function (done) {
					sequence.add = function (cb) {

						var fn = Promise.promisify(cb);

						fn().catch(function (err) {
							expect(info.args[0][0]).to.equal('Fork');
							expect(info.args[0][1].cause).to.equal(1);
							expect(info.args[0][1].delegate).to.equal(forkOneScenarios[0].generatorPublicKey);
							expect(info.args[0][1].block.height).to.equal(forkOneScenarios[0].height);
							expect(info.args[0][1].block.id).to.equal(forkOneScenarios[0].id);
							expect(info.args[0][1].block.previousBlock).to.equal(forkOneScenarios[0].previousBlock);
							expect(info.args[0][1].block.timestamp).to.equal(forkOneScenarios[0].timestamp);
							expect(info.args[1][0]).to.equal('Last block and parent loses');
							expect(error.args[0][1]).to.equal('Failed to verify block signature');
							expect(error.args[1][0]).to.equal('Fork recovery failed');
							expect(error.args[1][1]).to.equal('Failed to verify block signature');
							expect(err.message).to.equal('Failed to verify block signature');
							forkOneScenarios[0].blockSignature = blockSignature;
							done();
						});
					};

					var blockSignature = forkOneScenarios[0].blockSignature;

					forkOneScenarios[0].blockSignature = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
					blocksProcess.onReceiveBlock(forkOneScenarios[0]);
				});

				describe('Same round', function () {

					it('should be ok when blocks have same publicKey generator', function (done) {
						sequence.add = function (cb) {

							var fn = Promise.promisify(cb);

							fn().then(function (err, res) {
								expect(err).to.be.undefined;
								expect(res).to.be.undefined;
								expect(info.args[0][0]).to.equal('Fork');
								expect(info.args[0][1].cause).to.equal(1);
								expect(info.args[0][1].delegate).to.equal(forkOneScenarios[0].generatorPublicKey);
								expect(info.args[0][1].block.height).to.equal(forkOneScenarios[0].height);
								expect(info.args[0][1].block.id).to.equal(forkOneScenarios[0].id);
								expect(info.args[0][1].block.previousBlock).to.equal(forkOneScenarios[0].previousBlock);
								expect(info.args[0][1].block.timestamp).to.equal(forkOneScenarios[0].timestamp);
								expect(info.args[1][0]).to.equal('Last block and parent loses');
								expect(debug.args[0][0]).to.equal('Performing backward tick');
								expect(warn.args[0][0]).to.equal('Deleting last block');
								expect(warn.args[0][1].id).to.equal(blocksData[1].id);
								expect(warn.args[1][0]).to.equal('Deleting last block');
								expect(warn.args[1][1].id).to.equal(blocksData[0].id);
								done();
							});
						};

						blocksProcess.onReceiveBlock(forkOneScenarios[0]);
					});

					addBlock(blocksData, 'restore', 0);
					addBlock(blocksData, 'restore', 1);

					it('should fail when blocks have different publicKey generator and last block generator is invalid', function (done) {
						sequence.add = function (cb) {

							var fn = Promise.promisify(cb);

							fn().catch(function (err) {
								expect(err.message).to.equal('Failed to verify slot: 3556603');
								expect(error.args[0][0]).to.equal('Expected generator: 01389197bbaf1afb0acd47bbfeabb34aca80fb372a8f694a1c0716b3398db746 Received generator: 0186d6cbee0c9b1a9783e7202f57fc234b1d98197ada1cc29cfbdf697a636ef1');
								expect(error.args[1][0]).to.equal('Fork recovery failed');
								expect(error.args[1][1]).to.equal('Failed to verify slot: 3556603');
								expect(info.args[0][0]).to.equal('Fork');
								expect(info.args[0][1].cause).to.equal(1);
								expect(info.args[0][1].delegate).to.equal(forkOneScenarios[1].generatorPublicKey);
								expect(info.args[0][1].block.height).to.equal(forkOneScenarios[1].height);
								expect(info.args[0][1].block.id).to.equal(forkOneScenarios[1].id);
								expect(info.args[0][1].block.previousBlock).to.equal(forkOneScenarios[1].previousBlock);
								expect(info.args[0][1].block.timestamp).to.equal(forkOneScenarios[1].timestamp);
								expect(info.args[1][0]).to.equal('Last block and parent loses');
								done();
							});
						};

						blocksProcess.onReceiveBlock(forkOneScenarios[1]);
					});

					it('should be ok when blocks have different publicKey generator and last block generator is valid', function (done) {
						sequence.add = function (cb) {

							var fn = Promise.promisify(cb);

							fn().then(function (err, res) {
								expect(err).to.be.undefined;
								expect(res).to.be.undefined;
								expect(debug.args[0][0]).to.equal('Performing backward tick');
								expect(debug.args[1][0]).to.equal('Performing backward tick');
								expect(warn.args[0][0]).to.equal('Deleting last block');
								expect(warn.args[0][1].id).to.equal(blocksData[1].id);
								expect(warn.args[1][0]).to.equal('Deleting last block');
								expect(warn.args[1][1].id).to.equal(blocksData[0].id);
								expect(info.args[0][0]).to.equal('Fork');
								expect(info.args[0][1].cause).to.equal(1);
								expect(info.args[0][1].delegate).to.equal(forkOneScenarios[2].generatorPublicKey);
								expect(info.args[0][1].block.height).to.equal(forkOneScenarios[2].height);
								expect(info.args[0][1].block.id).to.equal(forkOneScenarios[2].id);
								expect(info.args[0][1].block.previousBlock).to.equal(forkOneScenarios[2].previousBlock);
								expect(info.args[0][1].block.timestamp).to.equal(forkOneScenarios[2].timestamp);
								expect(info.args[1][0]).to.equal('Last block and parent loses');
								done();
							}).catch(function (err, res) {
								console.log(err,res);
							});
						};

						blocksProcess.onReceiveBlock(forkOneScenarios[2]);
					});
				});

				describe('Round changes', function () {

					addBlock(blocksData, 'restore', 0);
					addBlock(blocksData, 'restore', 1);
					addBlock(blocksData, 'restore', 2);

					it('should fail when block generator not match last block of round generator', function (done) {
						sequence.add = function (cb) {

							var fn = Promise.promisify(cb);

							fn().catch(function (err) {
								expect(err.message).to.equal('Failed to verify slot: 3556604');
								expect(error.args[0][0]).to.equal('Expected generator: 01389197bbaf1afb0acd47bbfeabb34aca80fb372a8f694a1c0716b3398db746 Received generator: 0186d6cbee0c9b1a9783e7202f57fc234b1d98197ada1cc29cfbdf697a636ef1');
								expect(error.args[1][0]).to.equal('Fork recovery failed');
								expect(error.args[1][1]).to.equal('Failed to verify slot: 3556604');
								expect(info.args[0][0]).to.equal('Fork');
								expect(info.args[0][1].cause).to.equal(1);
								expect(info.args[0][1].delegate).to.equal(forkOneScenarios[4].generatorPublicKey);
								expect(info.args[0][1].block.height).to.equal(forkOneScenarios[4].height);
								expect(info.args[0][1].block.id).to.equal(forkOneScenarios[4].id);
								expect(info.args[0][1].block.previousBlock).to.equal(forkOneScenarios[4].previousBlock);
								expect(info.args[0][1].block.timestamp).to.equal(forkOneScenarios[4].timestamp);
								expect(info.args[1][0]).to.equal('Last block and parent loses');
								done();
							});
						};

						blocksProcess.onReceiveBlock(forkOneScenarios[4]);
					});

					it('should be ok when block match last block of round generator', function (done) {
						sequence.add = function (cb) {

							var fn = Promise.promisify(cb);

							fn().then(function (err, res) {
								expect(err).to.be.undefined;
								expect(res).to.be.undefined;
								expect(debug.args[0][0]).to.equal('Summing round');
								expect(debug.args[0][1]).to.equal(1);
								expect(debug.args[1][0]).to.equal('Performing backward tick');
								expect(warn.args[0][0]).to.equal('Deleting last block');
								expect(warn.args[0][1].id).to.equal(blocksData[2].id);
								expect(warn.args[1][0]).to.equal('Deleting last block');
								expect(warn.args[1][1].id).to.equal(blocksData[1].id);
								expect(info.args[0][0]).to.equal('Fork');
								expect(info.args[0][1].cause).to.equal(1);
								expect(info.args[0][1].delegate).to.equal(forkOneScenarios[5].generatorPublicKey);
								expect(info.args[0][1].block.height).to.equal(forkOneScenarios[5].height);
								expect(info.args[0][1].block.id).to.equal(forkOneScenarios[5].id);
								expect(info.args[0][1].block.previousBlock).to.equal(forkOneScenarios[5].previousBlock);
								expect(info.args[0][1].block.timestamp).to.equal(forkOneScenarios[5].timestamp);
								expect(info.args[1][0]).to.equal('Last block and parent loses');
								done();
							});
						};

						blocksProcess.onReceiveBlock(forkOneScenarios[5]);
					});
				});
			});
		});


		describe('receiveForkFive', function () {

			addBlock(blocksData, 'restore', 1);

			describe('timestamp is greather than previous block', function () {

				it('should be ok when last block stands and blocks have same publicKey generator', function (done) {
					sequence.add = function (cb) {

						var fn = Promise.promisify(cb);

						fn().then(function (err, res) {
							expect(err).to.be.undefined;
							expect(res).to.be.undefined;
							expect(warn.args[0][0]).to.equal('Delegate forging on multiple nodes');
							expect(warn.args[0][1]).to.equal(forkFiveScenarios[0].generatorPublicKey);
							expect(info.args[0][0]).to.equal('Fork');
							expect(info.args[0][1].cause).to.equal(5);
							expect(info.args[0][1].delegate).to.equal(forkFiveScenarios[0].generatorPublicKey);
							expect(info.args[0][1].block.height).to.equal(forkFiveScenarios[0].height);
							expect(info.args[0][1].block.id).to.equal(forkFiveScenarios[0].id);
							expect(info.args[0][1].block.previousBlock).to.equal(forkFiveScenarios[0].previousBlock);
							expect(info.args[0][1].block.timestamp).to.equal(forkFiveScenarios[0].timestamp);
							expect(info.args[1][0]).to.equal('Last block stands');
							forkFiveScenarios[0].timestamp = timestamp;
							done();
						});
					};

					var timestamp = forkFiveScenarios[0].timestamp;

					forkFiveScenarios[0].timestamp = blocksData[1].timestamp + 1;
					blocksProcess.onReceiveBlock(forkFiveScenarios[0]);
				});

				it('should be ok when last block stands and blocks have different publicKey generator', function (done) {
					sequence.add = function (cb) {

						var fn = Promise.promisify(cb);

						fn().then(function (err, res) {
							expect(err).to.be.undefined;
							expect(res).to.be.undefined;
							expect(info.args[0][0]).to.equal('Fork');
							expect(info.args[0][1].cause).to.equal(5);
							expect(info.args[0][1].delegate).to.equal(forkFiveScenarios[2].generatorPublicKey);
							expect(info.args[0][1].block.height).to.equal(forkFiveScenarios[2].height);
							expect(info.args[0][1].block.id).to.equal(forkFiveScenarios[2].id);
							expect(info.args[0][1].block.previousBlock).to.equal(forkFiveScenarios[2].previousBlock);
							expect(info.args[0][1].block.timestamp).to.equal(forkFiveScenarios[2].timestamp);
							expect(info.args[1][0]).to.equal('Last block stands');
							done();
						});
					};

					blocksProcess.onReceiveBlock(forkFiveScenarios[2]);
				});
			});

			describe('timestamp is lower than previous block', function () {

				it('should fail when block object normalize', function (done) {
					sequence.add = function (cb) {

						var fn = Promise.promisify(cb);

						fn().catch(function (err) {
							expect(warn.args[0][0]).to.equal('Delegate forging on multiple nodes');
							expect(warn.args[0][1]).to.equal(forkFiveScenarios[0].generatorPublicKey);
							expect(info.args[0][0]).to.equal('Fork');
							expect(info.args[0][1].cause).to.equal(5);
							expect(info.args[0][1].delegate).to.equal(forkFiveScenarios[0].generatorPublicKey);
							expect(info.args[0][1].block.height).to.equal(forkFiveScenarios[0].height);
							expect(info.args[0][1].block.id).to.equal(forkFiveScenarios[0].id);
							expect(info.args[0][1].block.previousBlock).to.equal(forkFiveScenarios[0].previousBlock);
							expect(info.args[0][1].block.timestamp).to.equal(forkFiveScenarios[0].timestamp);
							expect(info.args[1][0]).to.equal('Last block loses');
							expect(error.args[0][0]).to.equal('Fork recovery failed');
							expect(error.args[0][1]).to.equal(['Failed to validate block schema: Object didn\'t pass validation for format signature:', forkFiveScenarios[0].blockSignature].join(' '));
							expect(err.message).to.equal(['Failed to validate block schema: Object didn\'t pass validation for format signature:', forkFiveScenarios[0].blockSignature].join(' '));
							forkFiveScenarios[0].blockSignature = blockSignature;
							done();
						});
					};

					var blockSignature = forkFiveScenarios[0].blockSignature;

					forkFiveScenarios[0].blockSignature = 'invalid-block-signature';
					blocksProcess.onReceiveBlock(forkFiveScenarios[0]);
				});

				it('should fail when block verify receipt', function (done) {
					sequence.add = function (cb) {

						var fn = Promise.promisify(cb);

						fn().catch(function (err) {
							expect(warn.args[0][0]).to.equal('Delegate forging on multiple nodes');
							expect(warn.args[0][1]).to.equal(forkFiveScenarios[0].generatorPublicKey);
							expect(info.args[0][0]).to.equal('Fork');
							expect(info.args[0][1].cause).to.equal(5);
							expect(info.args[0][1].delegate).to.equal(forkFiveScenarios[0].generatorPublicKey);
							expect(info.args[0][1].block.height).to.equal(forkFiveScenarios[0].height);
							expect(info.args[0][1].block.id).to.equal(forkFiveScenarios[0].id);
							expect(info.args[0][1].block.previousBlock).to.equal(forkFiveScenarios[0].previousBlock);
							expect(info.args[0][1].block.timestamp).to.equal(forkFiveScenarios[0].timestamp);
							expect(info.args[1][0]).to.equal('Last block loses');
							expect(error.args[0][1]).to.equal('Failed to verify block signature');
							expect(error.args[1][0]).to.equal('Fork recovery failed');
							expect(error.args[1][1]).to.equal('Failed to verify block signature');
							expect(err.message).to.equal('Failed to verify block signature');
							forkFiveScenarios[0].blockSignature = blockSignature;
							done();
						});
					};

					var blockSignature = forkFiveScenarios[0].blockSignature;

					forkFiveScenarios[0].blockSignature = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
					blocksProcess.onReceiveBlock(forkFiveScenarios[0]);
				});

				describe('Same round', function () {

					it('should fail when blocks have different generator and last block generator is invalid', function (done) {
						sequence.add = function (cb) {

							var fn = Promise.promisify(cb);

							fn().catch(function (err) {
								expect(err.message).to.equal('Failed to verify slot: 3556603');
								expect(error.args[0][0]).to.equal('Expected generator: 01389197bbaf1afb0acd47bbfeabb34aca80fb372a8f694a1c0716b3398db746 Received generator: 0186d6cbee0c9b1a9783e7202f57fc234b1d98197ada1cc29cfbdf697a636ef1');
								expect(error.args[1][0]).to.equal('Fork recovery failed');
								expect(error.args[1][1]).to.equal('Failed to verify slot: 3556603');
								expect(info.args[0][0]).to.equal('Fork');
								expect(info.args[0][1].cause).to.equal(5);
								expect(info.args[0][1].delegate).to.equal(forkFiveScenarios[1].generatorPublicKey);
								expect(info.args[0][1].block.height).to.equal(forkFiveScenarios[1].height);
								expect(info.args[0][1].block.id).to.equal(forkFiveScenarios[1].id);
								expect(info.args[0][1].block.previousBlock).to.equal(forkFiveScenarios[1].previousBlock);
								expect(info.args[0][1].block.timestamp).to.equal(forkFiveScenarios[1].timestamp);
								expect(info.args[1][0]).to.equal('Last block loses');
								done();
							});
						};

						blocksProcess.onReceiveBlock(forkFiveScenarios[1]);
					});

					it('should be ok when last block loses and blocks have same publicKey generator', function (done) {
						sequence.add = function (cb) {

							var fn = Promise.promisify(cb);

							fn().then(function (err, res) {
								expect(err).to.be.undefined;
								expect(res).to.be.undefined;
								expect(debug.args[0][0]).to.equal('Performing backward tick');
								expect(debug.args[1][0]).to.equal('Block applied correctly with 0 transactions');
								expect(debug.args[2][0]).to.equal('Performing forward tick');
								expect(warn.args[0][0]).to.equal('Delegate forging on multiple nodes');
								expect(warn.args[0][1]).to.equal(forkFiveScenarios[0].generatorPublicKey);
								expect(warn.args[1][0]).to.equal('Deleting last block');
								expect(warn.args[1][1].id).to.equal(blocksData[1].id);
								expect(info.args[0][0]).to.equal('Fork');
								expect(info.args[0][1].cause).to.equal(5);
								expect(info.args[0][1].delegate).to.equal(forkFiveScenarios[0].generatorPublicKey);
								expect(info.args[0][1].block.height).to.equal(forkFiveScenarios[0].height);
								expect(info.args[0][1].block.id).to.equal(forkFiveScenarios[0].id);
								expect(info.args[0][1].block.previousBlock).to.equal(forkFiveScenarios[0].previousBlock);
								expect(info.args[0][1].block.timestamp).to.equal(forkFiveScenarios[0].timestamp);
								expect(info.args[1][0]).to.equal('Last block loses');
								expect(info.args[2][0]).to.equal([
									'Received new block id:', forkFiveScenarios[0].id,
									'height:', forkFiveScenarios[0].height,
									'round:',  slots.getSlotNumber(forkFiveScenarios[0].height),
									'slot:', slots.getSlotNumber(forkFiveScenarios[0].timestamp),
									'reward:', forkFiveScenarios[0].reward
								].join(' '));
								done();
							});
						};

						blocksProcess.onReceiveBlock(forkFiveScenarios[0]);
					});

					deleteLastBlock();
					addBlock(forkFiveScenarios, 'previous generator missed round', 2);

					it('should be ok when last block loses and blocks have different publicKey generator', function (done) {
						sequence.add = function (cb) {

							var fn = Promise.promisify(cb);

							fn().then(function (err, res) {
								expect(err).to.be.undefined;
								expect(res).to.be.undefined;
								expect(debug.args[0][0]).to.equal('Performing backward tick');
								expect(debug.args[1][0]).to.equal('Block applied correctly with 0 transactions');
								expect(debug.args[2][0]).to.equal('Performing forward tick');
								expect(debug.args[3][0]).to.equal('Performing round snapshot...');
								expect(warn.args[0][0]).to.equal('Deleting last block');
								expect(warn.args[0][1].id).to.equal(forkFiveScenarios[2].id);
								expect(info.args[0][0]).to.equal('Fork');
								expect(info.args[0][1].cause).to.equal(5);
								expect(info.args[0][1].delegate).to.equal(forkFiveScenarios[0].generatorPublicKey);
								expect(info.args[0][1].block.height).to.equal(forkFiveScenarios[0].height);
								expect(info.args[0][1].block.id).to.equal(forkFiveScenarios[0].id);
								expect(info.args[0][1].block.previousBlock).to.equal(forkFiveScenarios[0].previousBlock);
								expect(info.args[0][1].block.timestamp).to.equal(forkFiveScenarios[0].timestamp);
								expect(info.args[1][0]).to.equal('Last block loses');
								expect(info.args[2][0]).to.equal([
									'Received new block id:', forkFiveScenarios[0].id,
									'height:', forkFiveScenarios[0].height,
									'round:',  slots.getSlotNumber(forkFiveScenarios[0].height),
									'slot:', slots.getSlotNumber(forkFiveScenarios[0].timestamp),
									'reward:', forkFiveScenarios[0].reward
								].join(' '));
								done();
							});
						};

						blocksProcess.onReceiveBlock(forkFiveScenarios[0]);
					});
				});

				describe('Round changes', function () {

					deleteLastBlock();
					addBlock(blocksData, 'restore', 1);
					addBlock(blocksData, 'restore', 2);

					it('should fail when last block loses and block generator not match last block of round generator', function (done) {
						sequence.add = function (cb) {

							var fn = Promise.promisify(cb);

							fn().catch(function (err) {
								expect(err.message).to.equal('Failed to verify slot: 3556604');
								expect(error.args[0][0]).to.equal('Expected generator: 03e811dda4f51323ac712cd12299410830d655ddffb104f2c9974d90bf8c583a Received generator: 0186d6cbee0c9b1a9783e7202f57fc234b1d98197ada1cc29cfbdf697a636ef1');
								expect(error.args[1][0]).to.equal('Fork recovery failed');
								expect(error.args[1][1]).to.equal('Failed to verify slot: 3556604');
								expect(info.args[0][0]).to.equal('Fork');
								expect(info.args[0][1].cause).to.equal(5);
								expect(info.args[0][1].delegate).to.equal(forkFiveScenarios[3].generatorPublicKey);
								expect(info.args[0][1].block.height).to.equal(forkFiveScenarios[3].height);
								expect(info.args[0][1].block.id).to.equal(forkFiveScenarios[3].id);
								expect(info.args[0][1].block.previousBlock).to.equal(forkFiveScenarios[3].previousBlock);
								expect(info.args[0][1].block.timestamp).to.equal(forkFiveScenarios[3].timestamp);
								expect(info.args[1][0]).to.equal('Last block loses');
								done();
							});
						};

						blocksProcess.onReceiveBlock(forkFiveScenarios[3]);
					});

					it('should be ok when blocks have same publicKey generator', function (done) {
						sequence.add = function (cb) {

							var fn = Promise.promisify(cb);

							fn().then(function (err, res) {
								expect(err).to.be.undefined;
								expect(res).to.be.undefined;
								expect(debug.args[0][0]).to.equal('Summing round');
								expect(debug.args[0][1]).to.equal(1);
								expect(debug.args[1][0]).to.equal('Performing backward tick');
								expect(debug.args[2][0]).to.equal('Restoring mem_round snapshot...');
								expect(debug.args[3][0]).to.equal('Restoring mem_accounts.vote snapshot...');
								expect(debug.args[4][0]).to.equal('Block applied correctly with 0 transactions');
								expect(debug.args[5][0]).to.equal('Summing round');
								expect(debug.args[5][1]).to.equal(1);
								expect(debug.args[6][0]).to.equal('Performing forward tick');
								expect(warn.args[0][0]).to.equal('Delegate forging on multiple nodes');
								expect(warn.args[0][1]).to.equal(forkFiveScenarios[4].generatorPublicKey);
								expect(warn.args[1][0]).to.equal('Deleting last block');
								expect(warn.args[1][1].id).to.equal(blocksData[2].id);
								expect(info.args[0][0]).to.equal('Fork');
								expect(info.args[0][1].cause).to.equal(5);
								expect(info.args[0][1].delegate).to.equal(forkFiveScenarios[4].generatorPublicKey);
								expect(info.args[0][1].block.height).to.equal(forkFiveScenarios[4].height);
								expect(info.args[0][1].block.id).to.equal(forkFiveScenarios[4].id);
								expect(info.args[0][1].block.previousBlock).to.equal(forkFiveScenarios[4].previousBlock);
								expect(info.args[0][1].block.timestamp).to.equal(forkFiveScenarios[4].timestamp);
								expect(info.args[1][0]).to.equal('Last block loses');
								expect(info.args[2][0]).to.equal([
									'Received new block id:', forkFiveScenarios[4].id,
									'height:', forkFiveScenarios[4].height,
									'round:',  slots.getSlotNumber(forkFiveScenarios[4].height),
									'slot:', slots.getSlotNumber(forkFiveScenarios[4].timestamp),
									'reward:', forkFiveScenarios[4].reward
								].join(' '));
								done();
							});
						};

						blocksProcess.onReceiveBlock(forkFiveScenarios[4]);
					});

					deleteLastBlock();
					addBlock(forkFiveScenarios, 'previous generator missed round', 5);

					it('should be ok when last block loses and block match last block of round generator', function (done) {
						sequence.add = function (cb) {

							var fn = Promise.promisify(cb);

							fn().then(function (err, res) {
								expect(err).to.be.undefined;
								expect(res).to.be.undefined;
								expect(debug.args[0][0]).to.equal('Summing round');
								expect(debug.args[0][1]).to.equal(1);
								expect(debug.args[1][0]).to.equal('Performing backward tick');
								expect(debug.args[2][0]).to.equal('Restoring mem_round snapshot...');
								expect(debug.args[3][0]).to.equal('Restoring mem_accounts.vote snapshot...');
								expect(debug.args[4][0]).to.equal('Block applied correctly with 0 transactions');
								expect(debug.args[5][0]).to.equal('Summing round');
								expect(debug.args[5][1]).to.equal(1);
								expect(debug.args[6][0]).to.equal('Performing forward tick');
								expect(warn.args[0][0]).to.equal('Deleting last block');
								expect(warn.args[0][1].id).to.equal(forkFiveScenarios[5].id);
								expect(info.args[0][0]).to.equal('Fork');
								expect(info.args[0][1].cause).to.equal(5);
								expect(info.args[0][1].delegate).to.equal(blocksData[2].generatorPublicKey);
								expect(info.args[0][1].block.height).to.equal(blocksData[2].height);
								expect(info.args[0][1].block.id).to.equal(blocksData[2].id);
								expect(info.args[0][1].block.previousBlock).to.equal(blocksData[2].previousBlock);
								expect(info.args[0][1].block.timestamp).to.equal(blocksData[2].timestamp);
								expect(info.args[1][0]).to.equal('Last block loses');
								expect(info.args[2][0]).to.equal([
									'Received new block id:', blocksData[2].id,
									'height:', blocksData[2].height,
									'round:',  slots.getSlotNumber(blocksData[2].height),
									'slot:', slots.getSlotNumber(blocksData[2].timestamp),
									'reward:', blocksData[2].reward
								].join(' '));
								done();
							});
						};

						blocksProcess.onReceiveBlock(blocksData[2]);
					});
				});
			});
		});

		describe('skipped blocks', function () {

			it('should fail when block already processed', function (done) {
				sequence.add = function (cb) {

					var fn = Promise.promisify(cb);

					fn().then(function (err, res) {
						expect(err).to.be.undefined;
						expect(res).to.be.undefined;
						expect(debug.args[0][0]).to.equal('Block already processed');
						expect(debug.args[0][1]).to.equal(blocksData[2].id);
						done();
					});
				};

				blocksProcess.onReceiveBlock(blocksData[2]);
			});

			it('should fail when discarded block', function (done) {
				sequence.add = function (cb) {

					var fn = Promise.promisify(cb);

					fn().then(function (err, res) {
						expect(err).to.be.undefined;
						expect(res).to.be.undefined;
						expect(warn.args[0][0]).to.equal([
							'Discarded block that does not match with current chain:', forkOneScenarios[0].id,
							'height:', forkOneScenarios[0].height,
							'round:',  slots.getSlotNumber(forkOneScenarios[0].height),
							'slot:', slots.getSlotNumber(forkOneScenarios[0].timestamp),
							'generator:', forkOneScenarios[0].generatorPublicKey
						].join(' '));
						done();
					});
				};

				blocksProcess.onReceiveBlock(forkOneScenarios[0]);
			});
		});
	});

	describe('onBind()', function () {

		it('should be ok');
	});
});
